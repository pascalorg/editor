import {
  type CadUnderlay,
  fromUnderlayBuffer,
  parseDxf,
  toUnderlayBuffer,
} from '@pascal-app/cad-import'
import { type AnyNodeId, CadUnderlayNode, saveAsset } from '@pascal-app/core'
import { primeCadUnderlay } from './cad-underlay-cache'

/**
 * Reading and parsing happen on the main thread. Measured on a 30 MB DXF
 * (a converted 6.8 MB production DWG, 200k entities): 174 ms to parse, 3 ms to
 * pack. A worker would move that off the main thread, but `@pascal-app/editor`
 * ships both as a library and inside a Next app, and worker URL resolution
 * differs per bundler — real complexity for a third of a second. Revisit if
 * files an order of magnitude larger show up; the seam is `analyzeCadFile`.
 */
const MAX_FILE_BYTES = 200 * 1024 * 1024

export type CadImportLayer = {
  name: string
  segmentCount: number
  /** What the drawing itself says: layers it froze or turned off start hidden. */
  visibleByDefault: boolean
}

export type CadImportWarning = {
  code: 'unitless' | 'implausible-units' | 'skipped-entities' | 'scattered-content' | 'empty'
  message: string
}

/**
 * A candidate interpretation for a drawing that declares no units, with the
 * building size it implies. Showing the consequence rather than the factor is
 * what lets someone without CAD knowledge pick correctly: "34.5 m wide" is
 * obviously a building and "34,500 m wide" is obviously not.
 */
export type CadUnitSuggestion = {
  label: string
  metersPerUnit: number
  widthMeters: number
  heightMeters: number
  /** True for the interpretation that yields a building-shaped result. */
  likely: boolean
  /** True for the unit the file's `$INSUNITS` header claims. */
  declared: boolean
}

export type CadImportAnalysis = {
  fileName: string
  fileSizeBytes: number
  /** The packed underlay asset, ready to be written. */
  buffer: ArrayBuffer
  underlay: CadUnderlay
  layers: CadImportLayer[]
  segmentCount: number
  /** Null when the drawing declared no units and the user must choose. */
  metersPerUnit: number | null
  unitSuggestions: CadUnitSuggestion[]
  skippedTypes: Record<string, number>
  warnings: CadImportWarning[]
}

const UNIT_CANDIDATES: { label: string; metersPerUnit: number }[] = [
  { label: 'Millimetres', metersPerUnit: 0.001 },
  { label: 'Centimetres', metersPerUnit: 0.01 },
  { label: 'Metres', metersPerUnit: 1 },
  { label: 'Inches', metersPerUnit: 0.0254 },
  { label: 'Feet', metersPerUnit: 0.3048 },
]

/**
 * Plausible extents for something a person would model, used to pick the
 * likely unit for an undeclared drawing. A single room is a few metres; a site
 * plan is a few hundred.
 */
const PLAUSIBLE_MIN_METERS = 2
const PLAUSIBLE_MAX_METERS = 500

export function suggestUnits(underlay: CadUnderlay): CadUnitSuggestion[] {
  const { minX, minY, maxX, maxY } = underlay.contentBounds
  const width = maxX - minX
  const height = maxY - minY

  const suggestions = UNIT_CANDIDATES.map((candidate) => ({
    label: candidate.label,
    metersPerUnit: candidate.metersPerUnit,
    widthMeters: width * candidate.metersPerUnit,
    heightMeters: height * candidate.metersPerUnit,
    likely: false,
    declared:
      underlay.metersPerUnit !== null &&
      Math.abs(candidate.metersPerUnit - underlay.metersPerUnit) < 1e-12,
  }))

  // The longest side is the honest test: a plan can be a thin strip, but a
  // building is never 3 mm long or 40 km across.
  let best = -1
  let bestScore = Number.POSITIVE_INFINITY
  for (const [index, suggestion] of suggestions.entries()) {
    const longest = Math.max(suggestion.widthMeters, suggestion.heightMeters)
    if (longest < PLAUSIBLE_MIN_METERS || longest > PLAUSIBLE_MAX_METERS) continue
    // Prefer the interpretation closest to a typical building's order of
    // magnitude rather than merely inside the range.
    const score = Math.abs(Math.log10(longest) - Math.log10(30))
    if (score < bestScore) {
      bestScore = score
      best = index
    }
  }
  if (best >= 0) suggestions[best]!.likely = true

  return suggestions
}

/**
 * How much larger the drawing's full extent is than its main content. Real
 * files carry strays and multi-sheet layouts; past this ratio it is worth
 * telling the user their drawing is probably several sheets side by side.
 */
const SCATTER_WARNING_RATIO = 2.5

export function analyzeCadDrawing(
  source: string,
  fileName: string,
  fileSizeBytes: number,
): CadImportAnalysis {
  const drawing = parseDxf(source)
  const buffer = toUnderlayBuffer(drawing)
  const underlay = fromUnderlayBuffer(buffer)

  const counts = new Array<number>(underlay.layers.length).fill(0)
  for (let i = 0; i < underlay.segmentLayers.length; i++) {
    const layer = underlay.segmentLayers[i]!
    if (layer < counts.length) counts[layer] = counts[layer]! + 1
  }

  const layers: CadImportLayer[] = underlay.layers
    .map((layer, index) => ({
      name: layer.name,
      segmentCount: counts[index] ?? 0,
      visibleByDefault: layer.visible,
    }))
    .filter((layer) => layer.segmentCount > 0)
    .sort((a, b) => b.segmentCount - a.segmentCount)

  const warnings: CadImportWarning[] = []
  const segmentCount = underlay.segmentLayers.length

  if (segmentCount === 0) {
    warnings.push({
      code: 'empty',
      message: 'No drawable geometry was found. Check that the file is an ASCII DXF.',
    })
  }

  const unitSuggestions = segmentCount > 0 ? suggestUnits(underlay) : []
  const likely = unitSuggestions.find((s) => s.likely)

  if (underlay.metersPerUnit === null && segmentCount > 0) {
    warnings.push({
      code: 'unitless',
      message: 'The drawing declares no units. Pick the one that gives a sensible size.',
    })
  } else if (likely && !likely.declared) {
    // A file can declare the wrong unit — a plan drawn in centimetres and saved
    // as millimetres imports ten times too big, and the header gives no hint.
    // The extent does: say what the declared unit implies and what would fit.
    const declared = unitSuggestions.find((s) => s.declared)
    warnings.push({
      code: 'implausible-units',
      message: declared
        ? `The file says ${declared.label.toLowerCase()}, which makes this drawing ${formatExtent(declared.widthMeters)} across. ${likely.label} would make it ${formatExtent(likely.widthMeters)}.`
        : 'The unit this file declares gives an implausible size for a building.',
    })
  }

  const skippedTotal = Object.values(drawing.stats.skippedTypes).reduce((sum, n) => sum + n, 0)
  if (skippedTotal > 0) {
    const types = Object.entries(drawing.stats.skippedTypes)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([type, count]) => `${count} ${type}`)
      .join(', ')
    warnings.push({
      code: 'skipped-entities',
      message: `${skippedTotal.toLocaleString()} entities were not imported (${types}). Text, hatches and dimensions are annotation and are not drawn.`,
    })
  }

  if (segmentCount > 0) {
    const full = extentArea(underlay.bounds)
    const content = extentArea(underlay.contentBounds)
    if (content > 0 && full / content > SCATTER_WARNING_RATIO) {
      warnings.push({
        code: 'scattered-content',
        message:
          'The drawing extends well past its main content — it likely holds several sheets side by side. Unlock the underlay to move the one you want over the origin.',
      })
    }
  }

  return {
    fileName,
    fileSizeBytes,
    buffer,
    underlay,
    layers,
    segmentCount,
    metersPerUnit: underlay.metersPerUnit,
    unitSuggestions,
    skippedTypes: drawing.stats.skippedTypes,
    warnings,
  }
}

export async function analyzeCadFile(file: File): Promise<CadImportAnalysis> {
  if (file.size > MAX_FILE_BYTES) {
    throw new Error(
      `That file is ${(file.size / 1024 / 1024).toFixed(0)} MB. The limit is ${MAX_FILE_BYTES / 1024 / 1024} MB.`,
    )
  }
  return analyzeCadDrawing(await file.text(), file.name, file.size)
}

export type CommitCadImportArgs = {
  analysis: CadImportAnalysis
  levelId: string
  /** Metres per drawing unit. Required when the drawing declared none. */
  metersPerUnit: number
  /** Layer names the user turned off, relative to the drawing's own state. */
  hiddenLayers?: string[]
  createNode: (node: CadUnderlayNode, parentId: AnyNodeId) => void
  /** The original file, kept alongside so the drawing can be re-imported. */
  sourceFile?: File
}

/**
 * Write the underlay asset and put its node on the level.
 *
 * The parsed geometry is published to the cache before the node exists, so the
 * drawing is on screen the moment the node mounts rather than after a round
 * trip back through IndexedDB.
 */
export async function commitCadImport({
  analysis,
  levelId,
  metersPerUnit,
  hiddenLayers = [],
  createNode,
  sourceFile,
}: CommitCadImportArgs): Promise<CadUnderlayNode> {
  const assetFile = new File([analysis.buffer], `${analysis.fileName}.underlay`, {
    type: 'application/octet-stream',
  })
  const url = await saveAsset(assetFile)
  const sourceUrl = sourceFile ? await saveAsset(sourceFile) : undefined

  primeCadUnderlay(url, analysis.underlay)

  const layers: Record<string, { visible: boolean }> = {}
  for (const name of hiddenLayers) {
    layers[name] = { visible: false }
  }

  const node = CadUnderlayNode.parse({
    name: stripExtension(analysis.fileName),
    url,
    sourceUrl,
    scale: metersPerUnit,
    layers,
    locked: true,
    position: [0, 0, 0],
    rotation: [0, 0, 0],
  })

  createNode(node, levelId as AnyNodeId)
  return node
}

function extentArea(bounds: { minX: number; minY: number; maxX: number; maxY: number }): number {
  return Math.max(0, bounds.maxX - bounds.minX) * Math.max(0, bounds.maxY - bounds.minY)
}

/**
 * A length in the unit that reads naturally at its size — the point of these
 * strings is to make a wrong unit obvious at a glance, and "30000 m" says it
 * less loudly than "30 km".
 */
export function formatExtent(meters: number): string {
  if (meters >= 10_000) return `${(meters / 1000).toFixed(0)} km`
  if (meters >= 1) return `${meters.toFixed(1)} m`
  if (meters >= 0.01) return `${(meters * 100).toFixed(1)} cm`
  return `${(meters * 1000).toFixed(1)} mm`
}

export function stripExtension(fileName: string): string {
  const trimmed = fileName.trim()
  if (!trimmed) return 'CAD drawing'
  const dot = trimmed.lastIndexOf('.')
  return dot > 0 ? trimmed.slice(0, dot) : trimmed
}

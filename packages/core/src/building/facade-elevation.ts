import { getCatalogMaterialById } from '../material-library'
import type {
  AnyNode,
  DoorNode,
  FenceNode,
  PanelNode,
  SlabNode,
  WallNode,
  WindowNode,
} from '../schema'
import { MATERIAL_SWATCHES } from './material-swatches'

/**
 * The facade preview drawn as an elevation, in its materials: what the model compares with the
 * photo before applying a unit. Victor runs 5 and 6 wrote units from a photo and only saw an ASCII
 * strip of them; the uniform grids they kept are obvious in a drawing.
 */

const GLASS = '#a9bcc8'
const DOOR_GLASS = '#8a9ea9'
const BARE_WALL = '#d8d4cc'
const FRAME = '#3a3a3a'
const PANEL = '#8a8a8a'
const RAILING = '#3a3a3a'
const DECK = '#9a9a9a'
const PARTITION = '#555555'
const MAX_WIDTH_PX = 880
const MAX_SCALE = 40
const MARGIN = 12
const LABEL = 18
const GAP = 14

/** A library reference's colour: a texture's swatch, a preset's own colour, else the fallback. */
export function materialColour(ref: string | undefined, fallback: string): string {
  if (!ref?.startsWith('library:')) return fallback
  const id = ref.slice('library:'.length)
  const swatch = MATERIAL_SWATCHES[id]
  if (swatch) return swatch
  const colour = getCatalogMaterialById(id)?.preset?.mapProperties?.color
  return typeof colour === 'string' ? colour : fallback
}

export type ElevationRun = {
  /** What the run is (a storey's name), before its width. */
  label?: string
  width: number
  height: number
  /** Where the run has wall, in metres along it; the whole width when absent. */
  spans?: readonly (readonly [number, number])[]
  partitions: readonly number[]
  partitionThickness: number
  nodes: readonly AnyNode[]
  skipped: number
  error: string | null
}

const escapeXml = (text: string) =>
  text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
const n = (value: number) => Math.round(value * 10) / 10

/** One SVG with every run stacked, at one scale so their proportions compare. */
export function facadeElevationSvg(
  runs: readonly ElevationRun[],
  paint: { wall?: string; frame?: string },
): string {
  const widest = Math.max(1, ...runs.map((run) => run.width))
  const scale = Math.min(MAX_SCALE, MAX_WIDTH_PX / widest)
  const wall = materialColour(paint.wall, BARE_WALL)
  const frame = materialColour(paint.frame, FRAME)
  const parts: string[] = []
  let top = MARGIN
  for (const run of runs) {
    const x = (metres: number) => n(MARGIN + metres * scale)
    const y = (metres: number) => n(top + LABEL + (run.height - metres) * scale)
    const notes = [
      ...(run.label ? [escapeXml(run.label)] : []),
      `${n(run.width)} m`,
      ...(run.skipped ? [`${run.skipped} skipped`] : []),
      ...(run.error ? [escapeXml(run.error)] : []),
    ]
    parts.push(
      `<text x="${MARGIN}" y="${top + 13}" font-family="sans-serif" font-size="12" fill="${run.error ? '#b3261e' : '#333'}">${notes.join(' · ')}</text>`,
      ...(run.spans ?? [[0, run.width]]).map(
        ([from, to]) =>
          `<rect data-part="wall" x="${x(from)}" y="${y(run.height)}" width="${n((to - from) * scale)}" height="${n(run.height * scale)}" fill="${wall}"/>`,
      ),
    )
    for (const node of run.nodes) {
      if (node.type !== 'panel') continue
      const panel = node as PanelNode
      const colour = materialColour(panel.slots?.surface as string | undefined, PANEL)
      const [cx, cy] = panel.position
      parts.push(
        `<rect data-part="panel" x="${x(cx - panel.width / 2)}" y="${y(cy + panel.height / 2)}" width="${n(panel.width * scale)}" height="${n(panel.height * scale)}" fill="${colour}"/>`,
      )
    }
    for (const node of run.nodes) {
      if (node.type !== 'window' && node.type !== 'door') continue
      const opening = node as WindowNode | DoorNode
      const [cx, cy] = opening.position
      const left = cx - opening.width / 2
      const bottom = cy - opening.height / 2
      const stroke = n(Math.max(1.5, 0.05 * scale))
      parts.push(
        `<rect data-part="${opening.type}" x="${x(left)}" y="${y(bottom + opening.height)}" width="${n(opening.width * scale)}" height="${n(opening.height * scale)}" fill="${opening.type === 'door' ? DOOR_GLASS : GLASS}" stroke="${frame}" stroke-width="${stroke}"/>`,
      )
      // Panes at their proportions: the model compares this drawing with the photo, where the
      // Victor's lower row of panes is shorter than the upper.
      const even = (count: number) => Array.from({ length: count }, () => 1)
      const columnRatios =
        opening.type === 'window'
          ? (opening.columnRatios ?? [1])
          : even((opening as DoorNode).leafCount ?? 1)
      const rowRatios = opening.type === 'window' ? (opening.rowRatios ?? [1]) : [1]
      const cuts = (ratios: readonly number[]) => {
        const total = ratios.reduce((sum, ratio) => sum + ratio, 0) || 1
        const shares: number[] = []
        let running = 0
        for (const ratio of ratios.slice(0, -1)) {
          running += ratio
          shares.push(running / total)
        }
        return shares
      }
      for (const share of cuts(columnRatios)) {
        const at = left + opening.width * share
        parts.push(
          `<line data-part="mullion" x1="${x(at)}" y1="${y(bottom)}" x2="${x(at)}" y2="${y(bottom + opening.height)}" stroke="${frame}" stroke-width="${stroke}"/>`,
        )
      }
      // Rows run top to bottom, as the window renders them.
      for (const share of cuts(rowRatios)) {
        const at = bottom + opening.height * (1 - share)
        parts.push(
          `<line data-part="transom" x1="${x(left)}" y1="${y(at)}" x2="${x(left + opening.width)}" y2="${y(at)}" stroke="${frame}" stroke-width="${stroke}"/>`,
        )
      }
    }
    for (const at of run.partitions)
      parts.push(
        `<rect data-part="partition" x="${x(at - run.partitionThickness / 2)}" y="${y(run.height)}" width="${n(Math.max(1, run.partitionThickness * scale))}" height="${n(run.height * scale)}" fill="${PARTITION}"/>`,
      )
    for (const node of run.nodes) {
      if (node.type === 'slab') {
        const xs = (node as SlabNode).polygon.map(([px]) => px)
        const left = Math.min(...xs)
        parts.push(
          `<rect data-part="balcony" x="${x(left)}" y="${y(0.18)}" width="${n((Math.max(...xs) - left) * scale)}" height="${n(0.18 * scale)}" fill="${DECK}"/>`,
        )
      }
      if (node.type === 'fence') {
        const fence = node as FenceNode
        const from = Math.min(fence.start[0], fence.end[0])
        const to = Math.max(fence.start[0], fence.end[0])
        if (to - from < 0.05) continue
        const height = fence.height ?? 1.1
        parts.push(
          `<rect data-part="railing" x="${x(from)}" y="${y(height)}" width="${n((to - from) * scale)}" height="${n(height * scale)}" fill="${RAILING}" fill-opacity="0.18" stroke="${RAILING}" stroke-width="1.5"/>`,
        )
      }
    }
    top += LABEL + run.height * scale + GAP
  }
  const width = n(MARGIN * 2 + widest * scale)
  const height = n(top - GAP + MARGIN)
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="#ffffff"/>${parts.join('')}</svg>`
}

/**
 * A facade as applied: the longest of these walls, each drawn from the openings and panels it now
 * holds. apply_facade returns it, so the model sees what it built beside the photo even when it
 * applied without previewing (Victor run 7 re-applied 723 walls without looking).
 */
export function facadeAppliedSvg(
  nodes: Readonly<Record<string, AnyNode>>,
  walls: readonly WallNode[],
  paint: { wall?: string; frame?: string },
  count = 3,
): string {
  const length = (wall: WallNode) =>
    Math.hypot(wall.end[0] - wall.start[0], wall.end[1] - wall.start[1])
  const runs: ElevationRun[] = [...walls]
    .sort((a, b) => length(b) - length(a))
    .slice(0, count)
    .map((wall) => ({
      width: length(wall),
      height: wall.height ?? 3,
      partitions: [],
      partitionThickness: 0,
      nodes: Object.values(nodes).filter(
        (node) =>
          node.parentId === wall.id &&
          (node.type === 'window' || node.type === 'door' || node.type === 'panel'),
      ),
      skipped: 0,
      error: null,
    }))
  return facadeElevationSvg(runs, paint)
}

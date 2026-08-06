import type { CadBounds, CadDrawing, CadLayer, CadParseStats } from './types'

const MAGIC = 0x50434144 // 'PCAD'
const VERSION = 1
const HEADER_BYTES = 16

/**
 * The runtime shape a `cad-underlay` node loads from its asset.
 *
 * Coordinates are **recentred drawing units**, not metres. Recentring keeps
 * magnitudes small enough for `Float32Array` to stay sub-millimetre accurate
 * even on survey-referenced drawings, and leaving the unit conversion out of
 * the buffer means recalibrating the scale is a node property change rather
 * than a rewrite of a multi-megabyte asset.
 */
export type CadUnderlay = {
  layers: CadLayer[]
  /** Flat `[x1, y1, x2, y2, ...]`, recentred on `origin`. */
  segments: Float32Array
  segmentLayers: Uint16Array
  /** Drawing-unit coordinates of the recentring origin, for round-tripping. */
  origin: readonly [number, number]
  /** Full extent, in the same recentred units as `segments`. */
  bounds: CadBounds
  /**
   * Extent with the outermost stray geometry trimmed away — what the drawing
   * is actually *about*, and what a preview should frame on. See
   * `contentBounds()` for why the two differ.
   */
  contentBounds: CadBounds
  /**
   * Metres per drawing unit as declared by the file, or null when the drawing
   * was unitless and the user must calibrate.
   */
  metersPerUnit: number | null
  stats: CadParseStats
}

type UnderlayManifest = {
  origin: [number, number]
  bounds: CadBounds
  contentBounds: CadBounds
  metersPerUnit: number | null
  layers: CadLayer[]
  stats: CadParseStats
}

/**
 * Fraction of points ignored at each end of each axis when deciding where the
 * drawing's content actually is.
 */
const CONTENT_TRIM = 0.005

/** Segments sampled for the analysis. Enough for a stable percentile. */
const CONTENT_SAMPLE_CAP = 200_000

/**
 * Below this many segments, neither pass runs: a percentage of a handful
 * rounds to zero anyway, "a gap wider than a fifth of the span" describes any
 * two of them, and a drawing that small has no strays worth protecting
 * against — you can see all of it at once and drag it where you want it.
 */
const MIN_SEGMENTS_FOR_ANALYSIS = 50

/** Floor on the trim, so one forgotten entity cannot set the extent. */
const MIN_TRIM_SEGMENTS = 2

/**
 * The drawing's extent with stray outliers trimmed away.
 *
 * Real CAD files carry geometry far outside the drawing proper — a stray block
 * dragged off-canvas, a forgotten construction line, a title block in model
 * space. In the first production file we tested, one misplaced person symbol
 * sat 130 m to the left of a 34 m building and stretched the bounding box to
 * four times the building's width.
 *
 * That matters because the naive bbox centre is where we put the scene origin:
 * with that outlier the origin landed 63 m away from the building, so an
 * imported drawing would appear nowhere near where the user is working. A
 * percentile-trimmed box ignores the strays without dropping their geometry —
 * they are still drawn, just no longer in charge of the framing.
 */
export function contentBounds(segments: Float64Array, segmentCount: number): CadBounds {
  if (segmentCount === 0) return { minX: 0, minY: 0, maxX: 0, maxY: 0 }

  const stride = Math.max(1, Math.ceil(segmentCount / CONTENT_SAMPLE_CAP))
  const sampleCount = Math.ceil(segmentCount / stride)

  // Cluster on segment MIDPOINTS, not endpoints.
  //
  // Endpoints misrepresent where geometry is. A rectangular building drawn as
  // parallel vertical lines has exactly two distinct endpoint Y values — one
  // per end — which is indistinguishable from two drawings stacked far apart,
  // and the split would throw half the building away. Every one of those lines
  // has its midpoint in the middle, so midpoints see the single cluster there
  // actually is.
  const midX = new Float64Array(sampleCount)
  const midY = new Float64Array(sampleCount)
  let written = 0
  for (let i = 0; i < segmentCount; i += stride) {
    midX[written] = (segments[i * 4]! + segments[i * 4 + 2]!) / 2
    midY[written] = (segments[i * 4 + 1]! + segments[i * 4 + 3]!) / 2
    written++
  }

  const [coreMinX, coreMaxX] = dominantRange(midX.subarray(0, written).sort())
  const [coreMinY, coreMaxY] = dominantRange(midY.subarray(0, written).sort())

  // The extent is then how far the surviving segments actually reach — their
  // endpoints, so a wall is measured end to end rather than from its middle.
  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY

  for (let i = 0; i < segmentCount; i++) {
    const cx = (segments[i * 4]! + segments[i * 4 + 2]!) / 2
    const cy = (segments[i * 4 + 1]! + segments[i * 4 + 3]!) / 2
    if (cx < coreMinX || cx > coreMaxX || cy < coreMinY || cy > coreMaxY) continue

    for (const offset of [0, 2] as const) {
      const x = segments[i * 4 + offset]!
      const y = segments[i * 4 + offset + 1]!
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }
  }

  // Nothing survived — only reachable when sampling missed the core entirely.
  // The full extent is a truthful answer; a collapsed one is not.
  return Number.isFinite(minX) ? { minX, minY, maxX, maxY } : fullBounds(segments, segmentCount)
}

function fullBounds(segments: Float64Array, segmentCount: number): CadBounds {
  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY
  for (let i = 0; i < segmentCount * 4; i += 2) {
    const x = segments[i]!
    const y = segments[i + 1]!
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (y < minY) minY = y
    if (y > maxY) maxY = y
  }
  return { minX, minY, maxX, maxY }
}

/**
 * A gap this large, relative to the span it sits in, reads as empty space
 * between separate drawings rather than a hole in one of them. Sheets in a
 * model-space layout are set well apart; rooms in a plan are not.
 */
const CLUSTER_GAP_FRACTION = 0.2

/** Bound on the split loop — a layout has sheets, not hundreds of them. */
const MAX_CLUSTER_SPLITS = 8

/**
 * The range along one axis that holds the drawing's main body.
 *
 * Percentile trimming alone is not enough. It handles a handful of strays, but
 * a real file is often a *layout*: several sheets side by side in model space,
 * with real geometry in each. Trimming half a percent off a drawing whose left
 * fifth is a separate sheet leaves the range — and so the scene origin —
 * sitting in the empty space between them.
 *
 * So first split on genuine gaps and keep the busier side, then trim the
 * survivors. Both passes are needed: the split finds the right sheet, the trim
 * cleans up the odd forgotten entity inside it.
 */
function dominantRange(sorted: Float64Array): [number, number] {
  let low = 0
  let high = sorted.length - 1

  if (sorted.length < MIN_SEGMENTS_FOR_ANALYSIS) return [sorted[low]!, sorted[high]!]

  for (let iteration = 0; iteration < MAX_CLUSTER_SPLITS; iteration++) {
    const span = sorted[high]! - sorted[low]!
    if (!(span > 0)) break

    let gapAt = -1
    let gapSize = 0
    for (let i = low; i < high; i++) {
      const gap = sorted[i + 1]! - sorted[i]!
      if (gap > gapSize) {
        gapSize = gap
        gapAt = i
      }
    }
    if (gapAt < 0 || gapSize < span * CLUSTER_GAP_FRACTION) break

    // Keep whichever side of the gap holds more of the drawing.
    if (gapAt - low >= high - (gapAt + 1)) high = gapAt
    else low = gapAt + 1
  }

  const remaining = high - low + 1
  const trim =
    remaining >= MIN_SEGMENTS_FOR_ANALYSIS
      ? Math.max(MIN_TRIM_SEGMENTS, Math.round(remaining * CONTENT_TRIM))
      : 0

  return [sorted[low + trim]!, sorted[high - trim]!]
}

/**
 * Pack a parsed drawing into the binary asset the editor stores via
 * `saveAsset()`.
 *
 * Layout: a 16-byte header, a JSON manifest (layer table, bounds, stats)
 * padded to a 4-byte boundary, then the segment coordinates and their layer
 * indices as raw typed arrays. The manifest is JSON because it is small and
 * worth being able to read by eye; the bulk is binary because it isn't.
 */
export function toUnderlayBuffer(drawing: CadDrawing): ArrayBuffer {
  const segmentCount = drawing.segmentLayers.length
  const { minX, minY, maxX, maxY } = drawing.bounds
  // Centre on the trimmed extent, not the raw bounding box — a single stray
  // entity would otherwise drag the scene origin tens of metres off the
  // building. See `contentBounds`.
  const content = contentBounds(drawing.segments, segmentCount)
  const originX = (content.minX + content.maxX) / 2
  const originY = (content.minY + content.maxY) / 2

  const segments = new Float32Array(segmentCount * 4)
  for (let i = 0; i < segmentCount * 4; i += 2) {
    segments[i] = drawing.segments[i]! - originX
    segments[i + 1] = drawing.segments[i + 1]! - originY
  }

  const manifest: UnderlayManifest = {
    origin: [originX, originY],
    bounds: {
      minX: minX - originX,
      minY: minY - originY,
      maxX: maxX - originX,
      maxY: maxY - originY,
    },
    contentBounds: {
      minX: content.minX - originX,
      minY: content.minY - originY,
      maxX: content.maxX - originX,
      maxY: content.maxY - originY,
    },
    metersPerUnit: drawing.units.metersPerUnit,
    layers: drawing.layers,
    stats: drawing.stats,
  }

  const json = new TextEncoder().encode(JSON.stringify(manifest))
  const jsonPadded = align4(json.byteLength)
  const total = HEADER_BYTES + jsonPadded + segments.byteLength + segmentCount * 2

  const buffer = new ArrayBuffer(total)
  const view = new DataView(buffer)
  view.setUint32(0, MAGIC, true)
  view.setUint16(4, VERSION, true)
  view.setUint16(6, 0, true)
  view.setUint32(8, json.byteLength, true)
  view.setUint32(12, segmentCount, true)

  new Uint8Array(buffer, HEADER_BYTES, json.byteLength).set(json)

  const segmentOffset = HEADER_BYTES + jsonPadded
  new Float32Array(buffer, segmentOffset, segmentCount * 4).set(segments)
  new Uint16Array(buffer, segmentOffset + segments.byteLength, segmentCount).set(
    drawing.segmentLayers,
  )

  return buffer
}

export function fromUnderlayBuffer(buffer: ArrayBuffer): CadUnderlay {
  const view = new DataView(buffer)
  if (view.getUint32(0, true) !== MAGIC) {
    throw new Error('Not a Pascal CAD underlay asset.')
  }
  const version = view.getUint16(4, true)
  if (version !== VERSION) {
    throw new Error(`Unsupported CAD underlay version ${version} (expected ${VERSION}).`)
  }

  const jsonLength = view.getUint32(8, true)
  const segmentCount = view.getUint32(12, true)
  const manifest = JSON.parse(
    new TextDecoder().decode(new Uint8Array(buffer, HEADER_BYTES, jsonLength)),
  ) as UnderlayManifest

  const segmentOffset = HEADER_BYTES + align4(jsonLength)
  const segments = new Float32Array(buffer, segmentOffset, segmentCount * 4)
  const segmentLayers = new Uint16Array(buffer, segmentOffset + segments.byteLength, segmentCount)

  return {
    layers: manifest.layers,
    segments,
    segmentLayers,
    origin: manifest.origin,
    bounds: manifest.bounds,
    contentBounds: manifest.contentBounds ?? manifest.bounds,
    metersPerUnit: manifest.metersPerUnit,
    stats: manifest.stats,
  }
}

function align4(byteLength: number): number {
  return (byteLength + 3) & ~3
}

import {
  isBandedShedSegment,
  normalizeRoofSegmentTrim,
  type RoofSegmentNode,
} from '../schema/nodes/roof-segment'

/** A shed's plan polygon, in its flat segment-local frame. */
export type ShedPlanPolygon = [number, number][]

export function getShedBandFacetCount(width: number): number {
  return Math.max(4, Math.min(32, Math.ceil(width / 0.4)))
}

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value)

/** The stored footprint pieces whose every point is a finite [x, z]; malformed ones are dropped. */
function storedShedPieces(segment: RoofSegmentNode): ShedPlanPolygon[] {
  const stored: unknown = segment.shedFootprintPieces
  if (!Array.isArray(stored)) return []
  return stored.flatMap((polygon: unknown) => {
    if (!Array.isArray(polygon)) return []
    const points = polygon.flatMap((point: unknown): ShedPlanPolygon => {
      if (!Array.isArray(point) || point.length < 2) return []
      const [x, z] = point
      return isFiniteNumber(x) && isFiniteNumber(z) ? [[x, z]] : []
    })
    return points.length >= 3 && points.length === polygon.length ? [points] : []
  })
}

function clipByLine(
  polygon: ShedPlanPolygon,
  lineStart: readonly [number, number],
  lineEnd: readonly [number, number],
  outsidePoint: readonly [number, number],
): ShedPlanPolygon {
  const lineDx = lineEnd[0] - lineStart[0]
  const lineDz = lineEnd[1] - lineStart[1]
  const outsideSide =
    Math.sign(
      lineDx * (outsidePoint[1] - lineStart[1]) - lineDz * (outsidePoint[0] - lineStart[0]),
    ) || 1
  const side = (point: readonly [number, number]) =>
    outsideSide * (lineDx * (point[1] - lineStart[1]) - lineDz * (point[0] - lineStart[0]))
  const clipped: ShedPlanPolygon = []
  for (const [index, current] of polygon.entries()) {
    const next = polygon[(index + 1) % polygon.length]
    if (!next) continue
    const currentSide = side(current)
    const nextSide = side(next)
    const currentInside = currentSide <= 1e-7
    if (currentInside) clipped.push([current[0], current[1]])
    if (currentInside !== nextSide <= 1e-7) {
      const ratio = currentSide / (currentSide - nextSide)
      clipped.push([
        current[0] + (next[0] - current[0]) * ratio,
        current[1] + (next[1] - current[1]) * ratio,
      ])
    }
  }
  return clipped
}

/** A managed shed's footprint: its rectangle less its trims, diagonal corner trims included. */
function managedShedFootprint(segment: RoofSegmentNode): ShedPlanPolygon {
  const trim = normalizeRoofSegmentTrim(segment)
  const left = -segment.width / 2 + trim.left
  const right = segment.width / 2 - trim.right
  const back = -segment.depth / 2 + trim.back
  const front = segment.depth / 2 - trim.front
  let polygon: ShedPlanPolygon = [
    [left, back],
    [right, back],
    [right, front],
    [left, front],
  ]
  const outsideX = segment.width / 2 + 1
  const outsideZ = segment.depth / 2 + 1
  const diagonals: [number, number, [number, number], [number, number], [number, number]][] = [
    [
      trim.frontLeftX,
      trim.frontLeftZ,
      [left + trim.frontLeftX, front],
      [left, front - trim.frontLeftZ],
      [-outsideX, outsideZ],
    ],
    [
      trim.frontRightX,
      trim.frontRightZ,
      [right, front - trim.frontRightZ],
      [right - trim.frontRightX, front],
      [outsideX, outsideZ],
    ],
    [
      trim.backLeftX,
      trim.backLeftZ,
      [left, back + trim.backLeftZ],
      [left + trim.backLeftX, back],
      [-outsideX, -outsideZ],
    ],
    [
      trim.backRightX,
      trim.backRightZ,
      [right - trim.backRightX, back],
      [right, back + trim.backRightZ],
      [outsideX, -outsideZ],
    ],
  ]
  for (const [legX, legZ, start, end, outside] of diagonals) {
    if (legX <= 0 || legZ <= 0 || polygon.length < 3) continue
    polygon = clipByLine(polygon, start, end, outside)
  }
  return polygon
}

/**
 * The plan pieces a shed is drawn from instead of its brush: its stored
 * footprint pieces, else a managed shed's trimmed rectangle; none for any
 * other segment.
 */
export function getShedFootprintPieces(segment: RoofSegmentNode): ShedPlanPolygon[] {
  if (segment.roofType !== 'shed') return []
  const stored = storedShedPieces(segment)
  if (stored.length > 0) return stored
  return segment.managedByParent ? [managedShedFootprint(segment)] : []
}

function clipAtX(
  polygon: readonly [number, number][],
  boundaryX: number,
  keepGreater: boolean,
): ShedPlanPolygon {
  const clipped: ShedPlanPolygon = []
  for (const [index, current] of polygon.entries()) {
    const next = polygon[(index + 1) % polygon.length]
    if (!next) continue
    const currentInside = keepGreater ? current[0] >= boundaryX : current[0] <= boundaryX
    const nextInside = keepGreater ? next[0] >= boundaryX : next[0] <= boundaryX
    if (currentInside) clipped.push([current[0], current[1]])
    if (currentInside === nextInside) continue
    const ratio = (boundaryX - current[0]) / (next[0] - current[0])
    clipped.push([boundaryX, current[1] + (next[1] - current[1]) * ratio])
  }
  return clipped
}

const signedArea = (polygon: readonly [number, number][]) =>
  polygon.reduce((area, point, index) => {
    const next = polygon[(index + 1) % polygon.length] ?? point
    return area + point[0] * next[1] - next[0] * point[1]
  }, 0)

/**
 * Pieces cut at the band's facet lines, so a curved shed bends each strip as
 * one flat facet: the same steps across its width the band is drawn with.
 */
function facetBandedRoofPieces(
  pieces: readonly ShedPlanPolygon[],
  width: number,
): ShedPlanPolygon[] {
  const facetCount = getShedBandFacetCount(width)
  const halfWidth = width / 2
  const facetWidth = width / facetCount
  return pieces.flatMap((piece) =>
    Array.from({ length: facetCount }, (_, index) => {
      const minX = -halfWidth + index * facetWidth
      const maxX = index === facetCount - 1 ? halfWidth : minX + facetWidth
      return clipAtX(clipAtX(piece, minX, true), maxX, false)
    }).filter((clipped) => clipped.length >= 3 && Math.abs(signedArea(clipped)) > 1e-8),
  )
}

/** A plan polygon without repeated points or straight-through vertices. */
export function sanitizeRoofPlanPolygon(polygon: ShedPlanPolygon): ShedPlanPolygon {
  const tolerance = 1e-8
  const points = polygon.filter((point, index) => {
    const previous = polygon.at(index - 1) ?? point
    return Math.hypot(point[0] - previous[0], point[1] - previous[1]) > tolerance
  })
  let changed = true
  while (changed && points.length >= 3) {
    changed = false
    for (const [index, point] of points.entries()) {
      const previous = points.at(index - 1)
      const next = points[(index + 1) % points.length]
      if (!(previous && next)) continue
      const cross =
        (point[0] - previous[0]) * (next[1] - point[1]) -
        (point[1] - previous[1]) * (next[0] - point[0])
      if (Math.abs(cross) > tolerance) continue
      points.splice(index, 1)
      changed = true
      break
    }
  }
  return points
}

/**
 * The outlines a shed's pieces are drawn as, counter-clockwise in the flat
 * frame: a curved shed's first piece cut into its band's facets, the rest as
 * stored, each cleaned and without the ones of no area.
 */
export function getShedRenderOutlines(
  segment: RoofSegmentNode,
  pieces: readonly ShedPlanPolygon[],
): ShedPlanPolygon[] {
  if (segment.roofType !== 'shed') return []
  const rendered = isBandedShedSegment(segment)
    ? [...facetBandedRoofPieces(pieces.slice(0, 1), segment.width), ...pieces.slice(1)]
    : pieces
  return rendered.flatMap((polygon) => {
    const sanitized = sanitizeRoofPlanPolygon(polygon)
    const area = signedArea(sanitized)
    if (Math.abs(area) <= 1e-9) return []
    return [area > 0 ? sanitized : [...sanitized].reverse()]
  })
}

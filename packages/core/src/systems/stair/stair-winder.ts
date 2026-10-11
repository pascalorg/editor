import type { StairNode, StairSegmentNode } from '../../schema'

export type StairWinderPoint = [number, number]
export type StairWinderLayout = {
  treads: {
    polygon: StairWinderPoint[]
    elevation: number
    startStation: number
    endStation: number
    startAngle: number
    endAngle: number
  }[]
  footprint: StairWinderPoint[]
  walkingLine: [number, number, number][]
  innerBoundary: [number, number, number][]
  outerBoundary: [number, number, number][]
  exit: { position: [number, number, number]; rotation: number }
  going: number
  narrowEndGoing: number
}

/** A square-ring quarter turn: tread rays meet square rims, including their corner. */
export function resolveStairWinder(
  segment: Pick<StairSegmentNode, 'width' | 'height' | 'stepCount' | 'winder'>,
): StairWinderLayout | null {
  if (!segment.winder) return null
  const { innerGap: gap, walkingLineOffset: offset, turn, division } = segment.winder
  const { width, height, stepCount: count } = segment
  if (
    !(
      Number.isFinite(width) &&
      width > 0 &&
      Number.isFinite(height) &&
      height > 0 &&
      Number.isInteger(count) &&
      count > 0 &&
      count <= 10000
    )
  )
    throw new RangeError('Winders require positive dimensions and 1–10,000 whole risers.')
  if (
    !(Number.isFinite(gap) && gap >= 0 && Number.isFinite(offset) && offset > 0 && offset <= width)
  )
    throw new RangeError('The winder walking line must lie within the flight width.')
  const radius = gap + offset
  const outer = gap + width
  const sign = turn === 'left' ? -1 : 1
  // Pivot lies beside the entry. Travel starts along +Z and ends toward the turn.
  const point = (r: number, angle: number): StairWinderPoint => {
    const scale = r / Math.max(Math.cos(angle), Math.sin(angle))
    return [sign * (gap + width / 2 - scale * Math.cos(angle)), scale * Math.sin(angle)]
  }
  const stationAngle = (station: number) =>
    station <= radius ? Math.atan2(station, radius) : Math.atan2(radius, 2 * radius - station)
  const angleStation = (angle: number) =>
    angle <= Math.PI / 4 ? radius * Math.tan(angle) : 2 * radius - radius / Math.tan(angle)
  const angles = Array.from({ length: count + 1 }, (_, index) =>
    division === 'equal-angle'
      ? ((index / count) * Math.PI) / 2
      : stationAngle((index / count) * 2 * radius),
  )
  const rim = (r: number, start: number, end: number) => [
    point(r, start),
    ...(start < Math.PI / 4 && end > Math.PI / 4 ? [point(r, Math.PI / 4)] : []),
    point(r, end),
  ]
  const treads = Array.from({ length: count }, (_, index) => {
    const start = angles[index]!,
      end = angles[index + 1]!
    const polygon = [...rim(outer, start, end), ...rim(gap, start, end).reverse()]
    return {
      polygon,
      elevation: ((index + 1) * height) / count,
      startStation: angleStation(start),
      endStation: angleStation(end),
      startAngle: start,
      endAngle: end,
    }
  })
  const boundary = (r: number): [number, number, number][] => {
    const samples = [...angles, Math.PI / 4].sort((a, b) => a - b)
    let treadIndex = 0
    return samples
      .filter((angle, index) => !index || Math.abs(angle - samples[index - 1]!) > 1e-10)
      .map((angle) => {
        const [x, z] = point(r, angle)
        while (treadIndex < count - 1 && angles[treadIndex + 1]! < angle) treadIndex++
        const index = treadIndex
        const startStation = angleStation(angles[index]!),
          endStation = angleStation(angles[index + 1]!)
        const progress = (angleStation(angle) - startStation) / (endStation - startStation)
        return [x, ((index + progress) * height) / count, z]
      })
  }
  const walkingLine = boundary(radius)
  return {
    treads,
    footprint: [...rim(outer, 0, Math.PI / 2), ...rim(gap, 0, Math.PI / 2).reverse()],
    walkingLine,
    innerBoundary: boundary(gap),
    outerBoundary: boundary(outer),
    exit: {
      position: [sign * (gap + width / 2), height, gap + width / 2],
      rotation: (sign * Math.PI) / 2,
    },
    going: Math.min(...treads.map((tread) => tread.endStation - tread.startStation)),
    narrowEndGoing:
      (gap / radius) * Math.min(...treads.map((tread) => tread.endStation - tread.startStation)),
  }
}

export type StairWinderConstructionPiece = {
  role: 'tread' | 'body'
  walkingTop: boolean
  index: number
  polygon: StairWinderPoint[]
  bottom: number[]
  top: number
}

/** Polygon prisms share the exact walking footprint; structure stays below its finished top. */
export function resolveWinderStairConstruction(
  segment: StairSegmentNode,
  absoluteHeight = 0,
  parent?: StairNode,
): StairWinderConstructionPiece[] | null {
  const layout = resolveStairWinder(segment)
  if (!layout) return null
  const c = segment.construction ?? parent?.construction
  const mode = c?.mode ?? (segment.fillToFloor ? 'solid' : 'waist')
  const finish = c?.finishThickness ?? 0,
    treadThickness = c?.treadThickness ?? segment.thickness
  const gap = segment.winder!.innerGap,
    width = segment.width,
    radius = gap + segment.winder!.walkingLineOffset
  const sign = segment.winder!.turn === 'left' ? -1 : 1,
    pivot = sign * (gap + width / 2)
  const rise = segment.height / segment.stepCount,
    slope = segment.height / (2 * radius)
  const waist = (c?.waistThickness ?? segment.thickness) * Math.sqrt(1 + slope * slope) + finish
  const parts =
    1 +
    Number(finish > 0) +
    Number((mode === 'solid' || mode === 'waist') && (c?.nosing ?? 0) > 0) +
    Number(mode !== 'solid' && mode !== 'waist' && c?.closedRisers) +
    (mode === 'side-stringers' ? 2 : mode === 'center-stringer' ? 1 : 0)
  if (segment.stepCount * parts * 2 > 10000)
    throw new RangeError(
      'Detailed winder construction exceeds the 10,000-surface computation budget. The authored values are preserved.',
    )
  const pieces: StairWinderConstructionPiece[] = []
  const angle = ([x, z]: StairWinderPoint) => Math.atan2(z, sign * (pivot - x))
  const station = (a: number) =>
    a <= Math.PI / 4 ? radius * Math.tan(a) : 2 * radius - radius / Math.tan(a)
  const point = (r: number, a: number): StairWinderPoint => {
    const scale = r / Math.max(Math.cos(a), Math.sin(a))
    return [pivot - sign * scale * Math.cos(a), scale * Math.sin(a)]
  }
  const polygon = (inner: number, outer: number, start: number, end: number) => {
    const rim = (r: number) => [
      point(r, start),
      ...(start < Math.PI / 4 && end > Math.PI / 4 ? [point(r, Math.PI / 4)] : []),
      point(r, end),
    ]
    return [...rim(outer), ...rim(inner).reverse()]
  }
  const emit = (
    role: StairWinderConstructionPiece['role'],
    index: number,
    poly: StairWinderPoint[],
    top: number,
    bottom: number | ((p: StairWinderPoint) => number),
    walkingTop = false,
  ) => {
    const n = poly.length / 2
    for (let i = 0; i < n - 1; i++) {
      const ids = [i, i + 1, poly.length - 2 - i, poly.length - 1 - i]
      const polygon = ids.map((j) => poly[j]!)
      const bottomValues = ids.map((j, k) =>
        typeof bottom === 'number'
          ? bottom
          : bottom(
              poly[j]![0] === pivot && poly[j]![1] === 0
                ? poly[ids[k === 2 ? 1 : k === 3 ? 0 : k]!]!
                : poly[j]!,
            ),
      )
      pieces.push({ role, index, polygon, top, bottom: bottomValues, walkingTop })
    }
  }
  for (const [index, tread] of layout.treads.entries()) {
    const start = tread.startAngle,
      end = tread.endAngle
    const top = tread.elevation - finish
    const nosing = c?.nosing ?? 0
    const approach = start - Math.atan2(nosing, radius)
    const full = polygon(gap, gap + width, approach, end)
    const walkingHeight = (p: StairWinderPoint) =>
      (index + (station(angle(p)) - tread.startStation) / (tread.endStation - tread.startStation)) *
      rise
    const underside = (p: StairWinderPoint) => Math.min(top - 1e-8, walkingHeight(p) - waist)
    if (mode === 'solid' || mode === 'waist') {
      emit(
        'body',
        index,
        tread.polygon,
        top,
        mode === 'solid'
          ? Math.min(-absoluteHeight, top - (c?.waistThickness ?? segment.thickness))
          : underside,
        finish === 0,
      )
      if (nosing > 0)
        emit('tread', index, polygon(gap, gap + width, approach, start), top, top - treadThickness)
    } else {
      emit('tread', index, full, top, top - treadThickness, finish === 0)
      if (c?.closedRisers)
        emit(
          'body',
          index,
          polygon(
            gap,
            gap + width,
            start,
            Math.min(end, start + Math.atan2(c.riserThickness, radius)),
          ),
          top,
          top - rise,
        )
    }
    if (finish > 0) emit('tread', index, full, tread.elevation, top, true)
    if (mode === 'side-stringers' || mode === 'center-stringer') {
      const band = c!.stringerWidth
      const bands =
        mode === 'side-stringers'
          ? [
              [gap, gap + band],
              [gap + width - band, gap + width],
            ]
          : [[radius - band / 2, radius + band / 2]]
      for (const [inner, outer] of bands)
        emit('body', index, polygon(inner!, outer!, start, end), top - treadThickness, (p) =>
          Math.min(
            top - treadThickness - 1e-8,
            walkingHeight(p) - treadThickness - finish - c!.stringerDepth,
          ),
        )
    }
  }
  return pieces
}

export function resolveStairWinderFootprint(
  segment: StairSegmentNode,
  parent?: StairNode,
): StairWinderPoint[] | null {
  const layout = resolveStairWinder(segment)
  if (!layout) return null
  const polygon = layout.footprint.map((point) => [...point] as StairWinderPoint)
  const nose = (segment.construction ?? parent?.construction)?.nosing ?? 0
  if (nose) {
    const radius = segment.winder!.innerGap + segment.winder!.walkingLineOffset
    polygon[0]![1] = (-(segment.winder!.innerGap + segment.width) * nose) / radius
    polygon[polygon.length - 1]![1] = (-segment.winder!.innerGap * nose) / radius
  }
  return polygon
}

import type { StairConstruction, StairNode, StairSegmentNode } from '../../schema'
import {
  measureStairDetail,
  STAIR_DETAIL_SURFACE_BUDGET,
  stairSegmentDetailError,
} from './stair-detail-budget'
import { resolveStairArcDimensions } from './stair-layout'
import { resolveStairWinder } from './stair-winder'

export type StairConstructionPiece = {
  role: 'tread' | 'body'
  walkingTop?: boolean
  index: number
  x0: number
  x1: number
  z0: number
  z1: number
  /** Closed run/elevation profile, in the segment's local frame. */
  profile: [number, number][]
  /** Underside is slope * localZ + intercept. */
  underside: [number, number]
  top: number
}

export function resolveStairConstruction(
  node: Pick<StairSegmentNode, 'construction'>,
  parent?: Pick<StairNode, 'construction'>,
): StairConstruction | null {
  return node.construction ?? parent?.construction ?? null
}

export function stairConstructionError(
  stair: StairNode,
  segments: readonly StairSegmentNode[],
): string | null {
  if (stair.stairType !== 'straight') {
    if (!stair.construction) return null
    const dimensions = resolveStairArcDimensions(stair, 0)
    if (!(dimensions.going > 0)) return 'Explicit arc construction requires a positive going.'
    if (Math.abs(dimensions.stepSweep) > Math.PI * 2)
      return 'One tread spans more than one turn; add risers or reduce the sweep.'
    return stairSegmentConstructionError({
      segmentType: 'stair',
      construction: stair.construction,
      width: dimensions.width,
      length: dimensions.going * dimensions.stepCount,
      stepCount: dimensions.stepCount,
    })
  }
  const flights = segments.length
    ? segments
    : [
        {
          segmentType: 'stair' as const,
          width: stair.width,
          length: 3,
          stepCount: Math.max(2, Math.round(stair.stepCount)),
          construction: undefined,
        },
      ]
  for (const segment of flights) {
    const error = stairSegmentConstructionError(segment, stair)
    if (error) return error
  }
  return null
}

export function stairSegmentConstructionError(
  segment: Pick<
    StairSegmentNode,
    'segmentType' | 'width' | 'length' | 'stepCount' | 'construction'
  > &
    Partial<Pick<StairSegmentNode, 'winder' | 'height'>>,
  parent?: StairNode,
): string | null {
  let winder = null
  try {
    winder = segment.winder ? resolveStairWinder({ ...segment, height: segment.height ?? 1 }) : null
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
  const construction = resolveStairConstruction(segment, parent)
  if (
    winder &&
    2 * straightStairConstructionDetailCost(segment, parent) > STAIR_DETAIL_SURFACE_BUDGET
  )
    return 'Detailed winder construction exceeds the 10,000-surface computation budget. The authored values are preserved.'
  if (!construction || segment.segmentType === 'landing') return null
  if (
    construction.mode !== 'solid' &&
    construction.mode !== 'waist' &&
    construction.closedRisers &&
    construction.riserThickness > (winder?.going ?? segment.length / segment.stepCount)
  )
    return 'Riser panels must fit within their treads.'
  if (
    (construction.mode === 'side-stringers' && construction.stringerWidth * 2 > segment.width) ||
    (construction.mode === 'center-stringer' && construction.stringerWidth > segment.width)
  )
    return 'Stringers must fit within the flight width.'
  if (
    winder &&
    construction.mode === 'center-stringer' &&
    (segment.winder!.walkingLineOffset < construction.stringerWidth / 2 ||
      segment.winder!.walkingLineOffset + construction.stringerWidth / 2 > segment.width)
  )
    return 'The center stringer must fit around the walking line within the winder width.'
  if (winder && construction.nosing >= segment.winder!.innerGap + segment.winder!.walkingLineOffset)
    return 'Winder nosing must be smaller than the walking-line radius.'
  return null
}

/** Bodies and finishes sit below the finished walking heights; nosing projects toward the approach. */
export function resolveStraightStairConstruction(
  segment: StairSegmentNode,
  absoluteHeight = 0,
  parent?: StairNode,
): StairConstructionPiece[] | null {
  const construction = resolveStairConstruction(segment, parent)
  if (!construction) return null
  const error = stairSegmentDetailError(segment) ?? stairSegmentConstructionError(segment, parent)
  if (error) throw new RangeError(error)
  if (straightStairConstructionDetailCost(segment, parent) > STAIR_DETAIL_SURFACE_BUDGET)
    throw new RangeError(
      'Detailed stair construction exceeds the 10,000-surface computation budget. The authored values are preserved.',
    )
  const { mode, treadThickness, finishThickness, nosing, riserThickness, closedRisers } =
    construction
  const landing = segment.segmentType === 'landing'
  const count = landing ? 1 : segment.stepCount
  const going = segment.length / count
  const riser = landing ? 0 : segment.height / count
  const slope = landing ? 0 : segment.height / segment.length
  const firstStructureTop = (landing ? 0 : riser) - finishThickness
  const solidBase =
    firstStructureTop > -absoluteHeight
      ? -absoluteHeight
      : firstStructureTop - construction.waistThickness
  const waistOffset = construction.waistThickness * Math.sqrt(1 + slope * slope) + finishThickness
  const pieces: StairConstructionPiece[] = []
  const box = (
    role: StairConstructionPiece['role'],
    index: number,
    x0: number,
    x1: number,
    z0: number,
    z1: number,
    bottom: number,
    top: number,
  ) => {
    if (!(top > bottom && x1 > x0 && z1 > z0)) return
    pieces.push({
      role,
      index,
      x0,
      x1,
      z0,
      z1,
      underside: [0, bottom],
      top,
      profile: [
        [z0, bottom],
        [z1, bottom],
        [z1, top],
        [z0, top],
      ],
    })
  }
  const x0 = -segment.width / 2,
    x1 = segment.width / 2
  for (let index = 0; index < count; index++) {
    const z0 = index * going,
      z1 = (index + 1) * going
    const top = landing ? 0 : (index + 1) * riser
    const structureTop = top - finishThickness
    const projection = landing ? 0 : nosing
    if (mode === 'solid' || mode === 'waist') {
      const underside: [number, number] =
        mode === 'solid'
          ? [
              0,
              landing
                ? -Math.max(absoluteHeight, construction.waistThickness + finishThickness)
                : solidBase,
            ]
          : [slope, -waistOffset]
      const lower = (z: number) => underside[0] * z + underside[1]
      const profile: [number, number][] = [
        [z0, structureTop],
        [z1, structureTop],
        [z1, lower(z1)],
        [z0, lower(z0)],
      ]
      pieces.push({
        role: 'body',
        walkingTop: finishThickness === 0,
        index,
        x0,
        x1,
        z0,
        z1,
        underside,
        top: structureTop,
        profile,
      })
      if (projection > 0)
        box(
          'tread',
          index,
          x0,
          x1,
          z0 - projection,
          z0,
          structureTop - treadThickness,
          structureTop,
        )
    } else {
      box('tread', index, x0, x1, z0 - projection, z1, structureTop - treadThickness, structureTop)
      if (closedRisers && !landing)
        box(
          'body',
          index,
          x0,
          x1,
          z0,
          Math.min(z1, z0 + riserThickness),
          top - riser - finishThickness,
          structureTop,
        )
    }
    if (finishThickness > 0) box('tread', index, x0, x1, z0 - projection, z1, structureTop, top)
  }
  if (!landing && (mode === 'side-stringers' || mode === 'center-stringer')) {
    const width = construction.stringerWidth
    const bands: [number, number][] =
      mode === 'side-stringers'
        ? [
            [x0, x0 + width],
            [x1 - width, x1],
          ]
        : [[-width / 2, width / 2]]
    const upperOffset = treadThickness + finishThickness
    const lowerOffset = upperOffset + construction.stringerDepth
    for (const [left, right] of bands)
      for (let index = 0; index < count; index++) {
        const z0 = index * going,
          z1 = (index + 1) * going
        const top = (index + 1) * riser - upperOffset
        pieces.push({
          role: 'body',
          index,
          x0: left,
          x1: right,
          z0,
          z1,
          underside: [slope, -lowerOffset],
          top,
          profile: [
            [z0, top],
            [z1, top],
            [z1, slope * z1 - lowerOffset],
            [z0, slope * z0 - lowerOffset],
          ],
        })
      }
  }
  return pieces
}

export type StairArcConstructionPiece = {
  role: 'tread' | 'body' | 'mixed'
  index: number
  innerRadius: number
  outerRadius: number
  startAngle: number
  endAngle: number
  bottomStart: number
  bottomEnd: number
  top: number
}

/** One flat tread projects onto at most one circle, even if its authored travel wraps farther. */
export function stairArcSliceCount(
  innerRadius: number,
  outerRadius: number,
  sweep: number,
): number {
  return Math.max(
    4,
    Math.min(
      24,
      Math.ceil(
        Math.min(Math.abs(sweep), Math.PI * 2) / (Math.PI / 18) +
          Math.max(0, (outerRadius - innerRadius) * 3),
      ),
    ),
  )
}

export function resolveArcStairConstruction(
  stair: StairNode,
  totalRise: number,
): StairArcConstructionPiece[] | null {
  const construction = stair.construction
  if (!construction) return null
  const error = measureStairDetail(stair, []).error
  if (error) throw new RangeError(error)
  const dimensions = resolveStairArcDimensions(stair, totalRise)
  const {
    innerRadius,
    outerRadius,
    walkingRadius,
    stepCount,
    stepSweep,
    sweepAngle,
    riserHeight,
    landingSweep,
  } = dimensions
  const { mode, treadThickness, finishThickness, nosing, riserThickness, closedRisers } =
    construction
  const direction = Math.sign(stepSweep) || 1
  const slope = totalRise / Math.max(Math.abs(sweepAngle) * walkingRadius, Number.EPSILON)
  const waistOffset = construction.waistThickness * Math.sqrt(1 + slope * slope) + finishThickness
  const solidBase =
    riserHeight - finishThickness > 0
      ? 0
      : riserHeight - finishThickness - construction.waistThickness
  const pieces: StairArcConstructionPiece[] = []
  const piece = (
    role: StairArcConstructionPiece['role'],
    index: number,
    inner: number,
    outer: number,
    start: number,
    end: number,
    bottomStart: number,
    bottomEnd: number,
    top: number,
  ) => {
    if (!(outer > inner && top > Math.max(bottomStart, bottomEnd) && Math.abs(end - start) > 0))
      return
    pieces.push({
      role,
      index,
      innerRadius: inner,
      outerRadius: outer,
      startAngle: start,
      endAngle: end,
      bottomStart,
      bottomEnd,
      top,
    })
  }
  for (let index = 0; index < stepCount; index++) {
    const start = -sweepAngle / 2 + index * stepSweep,
      end = start + stepSweep
    const top = (index + 1) * riserHeight,
      structureTop = top - finishThickness
    const approach = start - (direction * nosing) / walkingRadius
    if (mode === 'solid' || mode === 'waist') {
      piece(
        finishThickness ? 'body' : 'mixed',
        index,
        innerRadius,
        outerRadius,
        start,
        end,
        mode === 'solid' ? solidBase : index * riserHeight - waistOffset,
        mode === 'solid' ? solidBase : top - waistOffset,
        structureTop,
      )
      if (nosing > 0)
        piece(
          'tread',
          index,
          innerRadius,
          outerRadius,
          approach,
          start,
          structureTop - treadThickness,
          structureTop - treadThickness,
          structureTop,
        )
    } else {
      piece(
        'tread',
        index,
        innerRadius,
        outerRadius,
        approach,
        end,
        structureTop - treadThickness,
        structureTop - treadThickness,
        structureTop,
      )
      if (closedRisers)
        piece(
          'body',
          index,
          innerRadius,
          outerRadius,
          start,
          start + (direction * riserThickness) / walkingRadius,
          top - riserHeight - finishThickness,
          top - riserHeight - finishThickness,
          structureTop,
        )
    }
    if (finishThickness > 0)
      piece(
        'tread',
        index,
        innerRadius,
        outerRadius,
        approach,
        end,
        structureTop,
        structureTop,
        top,
      )
    if (mode === 'side-stringers' || mode === 'center-stringer') {
      const width = construction.stringerWidth
      const bands: [number, number][] =
        mode === 'side-stringers'
          ? [
              [innerRadius, innerRadius + width],
              [outerRadius - width, outerRadius],
            ]
          : [[walkingRadius - width / 2, walkingRadius + width / 2]]
      const upperOffset = treadThickness + finishThickness
      const lowerOffset = upperOffset + construction.stringerDepth
      for (const [inner, outer] of bands)
        piece(
          'body',
          index,
          inner,
          outer,
          start,
          end,
          index * riserHeight - lowerOffset,
          top - lowerOffset,
          top - upperOffset,
        )
    }
  }
  if (landingSweep) {
    const top = totalRise,
      structureTop = top - finishThickness
    const thickness =
      mode === 'solid' || mode === 'waist' ? construction.waistThickness : treadThickness
    piece(
      finishThickness ? 'body' : mode === 'solid' || mode === 'waist' ? 'mixed' : 'tread',
      stepCount,
      innerRadius,
      outerRadius,
      sweepAngle / 2,
      sweepAngle / 2 + landingSweep,
      structureTop - thickness,
      structureTop - thickness,
      structureTop,
    )
    if (finishThickness > 0)
      piece(
        'tread',
        stepCount,
        innerRadius,
        outerRadius,
        sweepAngle / 2,
        sweepAngle / 2 + landingSweep,
        structureTop,
        structureTop,
        top,
      )
  }
  return pieces
}

export function straightStairConstructionDetailCost(
  segment: Pick<StairSegmentNode, 'construction' | 'segmentType' | 'stepCount'>,
  parent?: StairNode,
): number {
  const construction = resolveStairConstruction(segment, parent)
  const count = segment.segmentType === 'landing' ? 1 : segment.stepCount
  if (!construction) return count
  if (segment.segmentType === 'landing') return 1 + Number(construction.finishThickness > 0)
  const closed = construction.mode === 'solid' || construction.mode === 'waist'
  const parts =
    1 +
    Number(closed && construction.nosing > 0) +
    Number(construction.finishThickness > 0) +
    Number(!closed && construction.closedRisers) +
    (construction.mode === 'side-stringers' ? 2 : construction.mode === 'center-stringer' ? 1 : 0)
  return count * parts
}

export function arcStairConstructionDetailCost(stair: StairNode): number {
  const dimensions = resolveStairArcDimensions(stair, 0)
  const { stepCount, innerRadius, outerRadius, walkingRadius, stepSweep, landingSweep } = dimensions
  const construction = stair.construction
  if (!construction) return stepCount + Number(landingSweep !== 0)
  const { mode, nosing, finishThickness, closedRisers, riserThickness, stringerWidth } =
    construction
  const slices = (inner: number, outer: number, sweep: number) =>
    2 * stairArcSliceCount(inner, outer, sweep)
  const closed = mode === 'solid' || mode === 'waist'
  let parts = slices(
    innerRadius,
    outerRadius,
    stepSweep + (Math.sign(stepSweep || 1) * nosing) / walkingRadius,
  )
  if (closed) {
    parts = slices(innerRadius, outerRadius, stepSweep)
    if (nosing > 0) parts += slices(innerRadius, outerRadius, nosing / walkingRadius)
  } else if (closedRisers) parts += slices(innerRadius, outerRadius, riserThickness / walkingRadius)
  if (finishThickness > 0)
    parts += slices(
      innerRadius,
      outerRadius,
      stepSweep + (Math.sign(stepSweep || 1) * nosing) / walkingRadius,
    )
  if (mode === 'side-stringers')
    parts +=
      slices(innerRadius, innerRadius + stringerWidth, stepSweep) +
      slices(outerRadius - stringerWidth, outerRadius, stepSweep)
  else if (mode === 'center-stringer')
    parts += slices(walkingRadius - stringerWidth / 2, walkingRadius + stringerWidth / 2, stepSweep)
  return (
    stepCount * parts +
    (landingSweep
      ? slices(innerRadius, outerRadius, landingSweep) * (1 + Number(finishThickness > 0))
      : 0)
  )
}

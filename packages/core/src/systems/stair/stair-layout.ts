import type { StairNode } from '../../schema'
import { measureStairDetail } from './stair-detail-budget'

export type StairArcStep = {
  startAngle: number
  endAngle: number
  bottom: number
  top: number
}

export function resolveStairArcDimensions(stair: StairNode, totalRise: number) {
  const spiral = stair.stairType === 'spiral'
  const stepCount = Math.max(2, Math.round(stair.stepCount ?? 10))
  const innerRadius = Math.max(0.001, stair.innerRadius ?? 0.9)
  const width = Math.max(stair.width ?? 1, 0.001)
  const outerRadius = innerRadius + width
  const walkingRadius = innerRadius + width / 2
  const sweepAngle = stair.sweepAngle ?? (spiral ? Math.PI * 2 : Math.PI / 2)
  const stepSweep = sweepAngle / stepCount
  const thickness = Math.max(stair.thickness ?? 0.25, 0.001)
  const riserHeight = totalRise / stepCount
  const landingSweep =
    spiral && stair.topLandingMode === 'integrated'
      ? Math.min(Math.PI * 2, Math.max(0.001, stair.topLandingDepth ?? 0.9) / walkingRadius) *
        Math.sign(sweepAngle || 1)
      : 0
  return {
    stepCount,
    innerRadius,
    outerRadius,
    width,
    walkingRadius,
    sweepAngle,
    stepSweep,
    thickness,
    riserHeight,
    going: Math.abs(stepSweep) * walkingRadius,
    landingSweep,
    nosingSweep: ((stair.construction?.nosing ?? 0) / walkingRadius) * Math.sign(sweepAngle || 1),
  }
}

/** Walking surfaces own the rise; tread thickness only locates their underside. */
export function resolveStairArcLayout(stair: StairNode, totalRise: number) {
  const detail = measureStairDetail(stair, [])
  if (detail.error) throw new RangeError(detail.error)
  const dimensions = resolveStairArcDimensions(stair, totalRise)
  const { stepCount, sweepAngle, stepSweep, riserHeight, thickness, landingSweep } = dimensions
  const spiral = stair.stairType === 'spiral'
  const steps: StairArcStep[] = Array.from({ length: stepCount }, (_, index) => {
    const top = riserHeight * (index + 1)
    return {
      startAngle: -sweepAngle / 2 + stepSweep * index,
      endAngle: -sweepAngle / 2 + stepSweep * (index + 1),
      top,
      bottom: !spiral && stair.fillToFloor ? 0 : top - thickness,
    }
  })
  const landing: StairArcStep | null = landingSweep
    ? {
        startAngle: sweepAngle / 2,
        endAngle: sweepAngle / 2 + landingSweep,
        top: totalRise,
        bottom: totalRise - thickness,
      }
    : null
  return { ...dimensions, steps, landing }
}

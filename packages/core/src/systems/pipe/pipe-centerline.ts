import { getWallCurveLength, sampleWallCenterline } from '../wall/wall-curve'

export type PipeCenterlineLike = {
  start: [number, number]
  end: [number, number]
  curveOffset?: number
  elevation: number
  rotate?: number
}

export type PipeCenterlinePoint3D = {
  x: number
  y: number
  z: number
}

export function clampPipeRotateDegrees(rotate: number | undefined) {
  return Math.max(0, Math.min(90, rotate ?? 0))
}

export function getPipeRotateRadians(pipe: Pick<PipeCenterlineLike, 'rotate'>) {
  return (clampPipeRotateDegrees(pipe.rotate) * Math.PI) / 180
}

export function samplePipeCenterline3D(
  node: PipeCenterlineLike,
  segments = 32,
): PipeCenterlinePoint3D[] {
  const planSamples = sampleWallCenterline(node, segments)
  const totalLength = getWallCurveLength(node, segments)
  if (planSamples.length < 2 || totalLength < 1e-6) {
    return [{ x: node.start[0], y: node.elevation, z: node.start[1] }]
  }

  const rotateRad = getPipeRotateRadians(node)
  const cosR = Math.cos(rotateRad)
  const sinR = Math.sin(rotateRad)
  const sx = node.start[0]
  const sz = node.start[1]

  const points: PipeCenterlinePoint3D[] = []
  let accumulated = 0

  for (let index = 0; index < planSamples.length; index += 1) {
    const plan = planSamples[index]!
    if (index > 0) {
      const previous = planSamples[index - 1]!
      accumulated += Math.hypot(plan.x - previous.x, plan.y - previous.y)
    }
    const t = accumulated / totalLength
    const dx = plan.x - sx
    const dz = plan.y - sz
    points.push({
      x: sx + dx * cosR,
      y: node.elevation + t * totalLength * sinR,
      z: sz + dz * cosR,
    })
  }

  return points
}

export function getPipeEndpoint3D(
  node: PipeCenterlineLike,
  endpoint: 'start' | 'end',
): PipeCenterlinePoint3D {
  const samples = samplePipeCenterline3D(node, 24)
  if (samples.length === 0) {
    return { x: node.start[0], y: node.elevation, z: node.start[1] }
  }
  return endpoint === 'start' ? samples[0]! : samples[samples.length - 1]!
}

export function getPipeMidpoint3D(node: PipeCenterlineLike): PipeCenterlinePoint3D {
  const samples = samplePipeCenterline3D(node, 24)
  return samples[Math.floor((samples.length - 1) / 2)] ?? samples[0]!
}

export function isPipeNearlyVertical(node: Pick<PipeCenterlineLike, 'rotate'>) {
  return clampPipeRotateDegrees(node.rotate) >= 89.5
}

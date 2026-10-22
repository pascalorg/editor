import { type AnyNode, nodeRegistry, type StairNode } from '@pascal-app/core'

type Point = [number, number]
export type TransitionProfile = { frontZ: number; samples: Point[] }

export function surfaceTransitionProfile(
  stair: StairNode,
  surface: AnyNode,
  length: number,
): TransitionProfile | null {
  if (!Number.isFinite(length)) return null
  const boundary = nodeRegistry.get(surface.type)?.capabilities?.surfaces?.top?.boundary
  if (!boundary) return null
  const surfaceOutline = boundary(surface, 0)
  if (surfaceOutline.length < 3) return null
  const pose = surface as AnyNode & {
    position?: [number, number, number]
    rotation?: number | [number, number, number]
  }
  const surfacePosition = pose.position ?? [0, 0, 0]
  const surfaceAngle = typeof pose.rotation === 'number' ? pose.rotation : (pose.rotation?.[1] ?? 0)
  const attached = stair.parentId === stair.destinationSurfaceId
  const parentCos = Math.cos(surfaceAngle),
    parentSin = Math.sin(surfaceAngle)
  const stairPosition: [number, number, number] = attached
    ? [
        surfacePosition[0] + parentCos * stair.position[0] + parentSin * stair.position[2],
        surfacePosition[1] + stair.position[1],
        surfacePosition[2] - parentSin * stair.position[0] + parentCos * stair.position[2],
      ]
    : stair.position
  const stairRotation = stair.rotation + (attached ? surfaceAngle : 0)
  const cc = Math.cos(stairRotation),
    cs = Math.sin(stairRotation)
  const highX = stairPosition[0] + cs * length
  const highZ = stairPosition[2] + cc * length
  const outline = surfaceOutline.map(([x, z]): Point => {
    const dx = x - highX
    const dz = z - highZ
    return [dx * cc - dz * cs, dx * cs + dz * cc]
  })

  const halfWidth = stair.width / 2
  const samples: Point[] = []
  const sampleXs = [
    -halfWidth,
    0,
    halfWidth,
    ...outline.map(([x]) => x).filter((x) => x > -halfWidth && x < halfWidth),
  ]
    .sort((a, b) => a - b)
    .filter((x, index, values) => index === 0 || x - values[index - 1]! > 1e-6)
  for (const x of sampleXs) {
    const crossings: number[] = []
    for (let edge = 0; edge < outline.length; edge++) {
      const a = outline[edge]!,
        b = outline[(edge + 1) % outline.length]!
      const dx = b[0] - a[0]
      if (Math.abs(dx) < 1e-8) continue
      const t = (x - a[0]) / dx
      if (t >= 0 && t <= 1) crossings.push(a[1] + (b[1] - a[1]) * t)
    }
    const boundary = crossings.sort((a, b) => Math.abs(a) - Math.abs(b))[0]
    if (boundary === undefined || boundary < -0.12 || boundary > 0.7) return null
    samples.push([x, boundary])
  }
  if (samples.every(([, z]) => Math.abs(z) < 0.015)) return null
  return { frontZ: 0, samples }
}

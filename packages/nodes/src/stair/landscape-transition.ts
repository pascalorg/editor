import type { StairNode } from '@pascal-app/core'

type Point = [number, number]
type LandscapeSurface = {
  position?: [number, number, number]
  rotation?: [number, number, number]
  width?: number
  depth?: number
  shape?: string
  outline?: Point[]
}

export type TransitionProfile = { frontZ: number; samples: Point[] }

export function landscapeTransitionProfile(
  stair: StairNode,
  surface: LandscapeSurface,
  length: number,
): TransitionProfile | null {
  if (!surface.position || !surface.width || !surface.depth || !Number.isFinite(length)) return null
  const { width, depth, shape } = surface
  const localOutline: Point[] =
    shape === 'circle' || shape === 'oval'
      ? Array.from({ length: 128 }, (_, index) => {
          const angle = (index * Math.PI * 2) / 128
          return [
            (Math.cos(angle) * width) / 2,
            (Math.sin(angle) * (shape === 'circle' ? width : depth)) / 2,
          ]
        })
      : shape !== 'rectangle' && surface.outline && surface.outline.length >= 3
        ? surface.outline.map(([x, z]): Point => [x * width, z * depth])
        : []
  if (localOutline.length < 3) return null

  const surfaceAngle = surface.rotation?.[1] ?? 0
  const attached = stair.parentId === stair.landscapeSurfaceId
  const parentCos = Math.cos(surfaceAngle),
    parentSin = Math.sin(surfaceAngle)
  const stairPosition: [number, number, number] = attached
    ? [
        surface.position[0] + parentCos * stair.position[0] + parentSin * stair.position[2],
        surface.position[1] + stair.position[1],
        surface.position[2] - parentSin * stair.position[0] + parentCos * stair.position[2],
      ]
    : stair.position
  const stairRotation = stair.rotation + (attached ? surfaceAngle : 0)
  const sc = Math.cos(surfaceAngle),
    ss = Math.sin(surfaceAngle)
  const cc = Math.cos(stairRotation),
    cs = Math.sin(stairRotation)
  const highX = stairPosition[0] + cs * length
  const highZ = stairPosition[2] + cc * length
  const outline = localOutline.map(([x, z]): Point => {
    const dx = surface.position![0] + x * sc + z * ss - highX
    const dz = surface.position![2] - x * ss + z * sc - highZ
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

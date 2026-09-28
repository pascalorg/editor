import type { AnyNode, StairNode } from '@pascal-app/core'

type Point = [number, number]
const surfaceKinds = new Set(['landscape:deck', 'landscape:patio', 'landscape:concrete-slab', 'landscape:landing'])
const SNAP_DISTANCE = 0.75

export type LandscapeStairSnap = {
  position: [number, number, number]
  rotation: number
  totalRise: number
  stepCount: number
  length: number
  surfaceId: string
}

/** Align a straight flight's high end to a nearby landscape surface edge. */
export function resolveLandscapeStairSnap(
  stair: StairNode,
  nodes: Readonly<Record<string, AnyNode>>,
  candidatePosition: [number, number, number],
  currentLength: number,
  baseElevation = candidatePosition[1],
): LandscapeStairSnap | null {
  if (stair.stairType !== 'straight' || stair.autoLandscapeSnap === false) return null
  const candidate: Point = [candidatePosition[0], candidatePosition[2]]
  const highEnd: Point = [candidate[0] + Math.sin(stair.rotation) * currentLength,
    candidate[1] + Math.cos(stair.rotation) * currentLength]
  let closest: { distance: number; snap: LandscapeStairSnap } | null = null
  for (const raw of Object.values(nodes)) {
    if (!surfaceKinds.has(raw.type as string) || raw.parentId !== stair.parentId) continue
    const surface = raw as unknown as {
      id: string; position?: [number, number, number]; rotation?: [number, number, number]
      width?: number; depth?: number; thickness?: number; elevation?: number
      slopePercent?: number; drainDirection?: string
      shape?: string; outline?: Point[]
    }
    if (!surface.position || !surface.width || !surface.depth || !surface.thickness) continue
    const width = surface.width, depth = surface.depth
    const angle = surface.rotation?.[1] ?? 0
    const cos = Math.cos(angle), sin = Math.sin(angle)
    const local: Point[] = surface.shape === 'circle' || surface.shape === 'oval'
      ? Array.from({ length: 128 }, (_, index): Point => {
        const theta = index * Math.PI * 2 / 128
        return [Math.cos(theta) * width / 2,
          Math.sin(theta) * (surface.shape === 'circle' ? width : depth) / 2]
      })
      : surface.shape !== 'rectangle' && surface.outline && surface.outline.length >= 3
        ? surface.outline.map(([x, z]) => [x * width, z * depth])
        : [[-width / 2, -depth / 2], [width / 2, -depth / 2],
            [width / 2, depth / 2], [-width / 2, depth / 2]]
    const outline = local.map(([x, z]): Point => [
      surface.position![0] + x * cos + z * sin,
      surface.position![2] - x * sin + z * cos,
    ])
    const area = outline.reduce((sum, p, index) => {
      const next = outline[(index + 1) % outline.length]!
      return sum + p[0] * next[1] - next[0] * p[1]
    }, 0)
    for (let index = 0; index < outline.length; index++) {
      const a = outline[index]!, b = outline[(index + 1) % outline.length]!
      const dx = b[0] - a[0], dz = b[1] - a[1]
      const size = Math.hypot(dx, dz)
      if (size < 1e-4) continue
      const project = (point: Point) => Math.max(0, Math.min(1,
        ((point[0] - a[0]) * dx + (point[1] - a[1]) * dz) / (size * size)))
      const lowT = project(candidate), highT = project(highEnd)
      const lowEdge: Point = [a[0] + dx * lowT, a[1] + dz * lowT]
      const highEdge: Point = [a[0] + dx * highT, a[1] + dz * highT]
      const lowDistance = Math.hypot(candidate[0] - lowEdge[0], candidate[1] - lowEdge[1])
      const highDistance = Math.hypot(highEnd[0] - highEdge[0], highEnd[1] - highEdge[1])
      const t = highDistance < lowDistance ? highT : lowT
      const edge: Point = [a[0] + dx * t, a[1] + dz * t]
      const direction = area >= 0 ? 1 : -1
      const nx = -dz / size * direction, nz = dx / size * direction
      const outside = -((candidate[0] - edge[0]) * nx + (candidate[1] - edge[1]) * nz)
      if (outside < -SNAP_DISTANCE || outside > 5) continue
      const distance = Math.min(lowDistance, highDistance)
      const catchDistance = stair.landscapeSurfaceId === surface.id ? 1.25 : SNAP_DISTANCE
      if (distance > catchDistance || (closest && distance >= closest.distance)) continue
      const patio = (raw.type as string) === 'landscape:patio'
      const localX = (edge[0] - surface.position[0]) * cos - (edge[1] - surface.position[2]) * sin
      const localZ = (edge[0] - surface.position[0]) * sin + (edge[1] - surface.position[2]) * cos
      const gradient = (surface.slopePercent ?? 0) / 100
      const slopeRise = surface.drainDirection === 'front' ? gradient * localZ
        : surface.drainDirection === 'back' ? -gradient * localZ
          : surface.drainDirection === 'left' ? gradient * localX
            : surface.drainDirection === 'right' ? -gradient * localX : 0
      const top = surface.position[1] + surface.thickness + (patio
        ? (surface.elevation ?? 0) + Math.min(0.045, surface.thickness / 3) + slopeRise : 0)
      const rise = top - baseElevation
      if (rise <= 0.01 || rise > 5) continue
      const stepCount = Math.max(1, Math.min(24, Math.round(rise / 0.16)))
      const minRun = stepCount * 0.28
      const length = Math.max(minRun, outside, 0.4)
      closest = { distance, snap: {
        position: [edge[0] - nx * length, candidatePosition[1], edge[1] - nz * length],
        rotation: Math.atan2(nx, nz), totalRise: rise, stepCount, length, surfaceId: surface.id,
      } }
    }
  }
  return closest?.snap ?? null
}

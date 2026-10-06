import { floorConstructionLift } from '../lib/floor-construction-lift'
import { isNodeKindEnabled, nodeRegistry } from '../registry/registry'
import type { StairNode } from '../schema/nodes/stair'
import type { AnyNode } from '../schema/types'

type Point = [number, number]
const SNAP_DISTANCE = 0.75

export type StairSurfaceSnap = {
  position: [number, number, number]
  rotation: number
  totalRise: number
  stepCount: number
  length: number
  surfaceId: string
}

/** Align a straight flight's high end to a nearby registered surface edge. */
export function resolveStairSurfaceSnap(
  stair: StairNode,
  nodes: Readonly<Record<string, AnyNode>>,
  candidatePosition: [number, number, number],
  currentLength: number,
  baseElevation = candidatePosition[1],
  installedPlugins?: readonly string[],
): StairSurfaceSnap | null {
  if (stair.stairType !== 'straight' || stair.autoLandscapeSnap === false) return null
  const candidate: Point = [candidatePosition[0], candidatePosition[2]]
  const highEnd: Point = [
    candidate[0] + Math.sin(stair.rotation) * currentLength,
    candidate[1] + Math.cos(stair.rotation) * currentLength,
  ]
  let closest: { distance: number; snap: StairSurfaceSnap } | null = null
  for (const raw of Object.values(nodes)) {
    if (
      raw.parentId !== stair.parentId ||
      raw.visible === false ||
      !isNodeKindEnabled(raw.type, installedPlugins)
    )
      continue
    const top = nodeRegistry.get(raw.type)?.capabilities?.surfaces?.top
    if (!top?.boundary) continue
    const surface = raw as AnyNode & { position?: [number, number, number] }
    const outline = top.boundary(raw, 0)
    if (outline.length < 3) continue
    const area = outline.reduce((sum, p, index) => {
      const next = outline[(index + 1) % outline.length]!
      return sum + p[0] * next[1] - next[0] * p[1]
    }, 0)
    for (let index = 0; index < outline.length; index++) {
      const a = outline[index]!,
        b = outline[(index + 1) % outline.length]!
      const dx = b[0] - a[0],
        dz = b[1] - a[1]
      const size = Math.hypot(dx, dz)
      if (size < 1e-4) continue
      const project = (point: Point) =>
        Math.max(0, Math.min(1, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dz) / (size * size)))
      const lowT = project(candidate),
        highT = project(highEnd)
      const lowEdge: Point = [a[0] + dx * lowT, a[1] + dz * lowT]
      const highEdge: Point = [a[0] + dx * highT, a[1] + dz * highT]
      const lowDistance = Math.hypot(candidate[0] - lowEdge[0], candidate[1] - lowEdge[1])
      const highDistance = Math.hypot(highEnd[0] - highEdge[0], highEnd[1] - highEdge[1])
      const t = highDistance < lowDistance ? highT : lowT
      const edge: Point = [a[0] + dx * t, a[1] + dz * t]
      const direction = area >= 0 ? 1 : -1
      const nx = (-dz / size) * direction,
        nz = (dx / size) * direction
      const outside = -((candidate[0] - edge[0]) * nx + (candidate[1] - edge[1]) * nz)
      if (outside < -SNAP_DISTANCE) continue
      const distance = Math.min(lowDistance, highDistance)
      const catchDistance = stair.landscapeSurfaceId === surface.id ? 1.25 : SNAP_DISTANCE
      if (distance > catchDistance || (closest && distance >= closest.distance)) continue
      const height =
        typeof top.height === 'function' ? top.height(raw, { nodes, point: edge }) : top.height
      const topElevation = (surface.position?.[1] ?? 0) + height + floorConstructionLift(nodes, raw)
      const rise = topElevation - baseElevation
      if (!Number.isFinite(rise) || rise <= 0.01) continue
      const stepCount = Math.max(1, Math.round(rise / 0.16))
      const minRun = stepCount * 0.28
      const length = Math.max(minRun, outside, 0.4)
      closest = {
        distance,
        snap: {
          position: [edge[0] - nx * length, candidatePosition[1], edge[1] - nz * length],
          rotation: Math.atan2(nx, nz),
          totalRise: rise,
          stepCount,
          length,
          surfaceId: surface.id,
        },
      }
    }
  }
  return closest?.snap ?? null
}

export function getBoundarySurfaces(
  nodes: Readonly<Record<string, AnyNode>>,
  parentId: string | null | undefined,
  installedPlugins?: readonly string[],
): AnyNode[] {
  return Object.values(nodes).filter(
    (node) =>
      node.parentId === parentId &&
      node.visible !== false &&
      isNodeKindEnabled(node.type, installedPlugins) &&
      Boolean(nodeRegistry.get(node.type)?.capabilities?.surfaces?.top?.boundary),
  )
}

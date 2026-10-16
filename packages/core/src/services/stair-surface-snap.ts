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
  if (stair.stairType !== 'straight' || stair.autoSurfaceSnap === false) return null
  const parentFrame = surfaceFrame(stair.parentId, nodes)
  const candidate = toFrame([candidatePosition[0], candidatePosition[2]], parentFrame)
  const rotation = stair.rotation + parentFrame.rotation
  const highEnd: Point = [
    candidate[0] + Math.sin(rotation) * currentLength,
    candidate[1] + Math.cos(rotation) * currentLength,
  ]
  let closest: { distance: number; snap: StairSurfaceSnap } | null = null
  for (const raw of Object.values(nodes)) {
    if (
      surfaceFrame(raw.parentId, nodes).levelId !== parentFrame.levelId ||
      raw.visible === false ||
      !isNodeKindEnabled(raw.type, installedPlugins)
    )
      continue
    const top = nodeRegistry.get(raw.type)?.capabilities?.surfaces?.top
    if (!top?.boundary) continue
    const surface = raw as AnyNode & { position?: [number, number, number] }
    const targetFrame = surfaceFrame(raw.parentId, nodes)
    const outline = top.boundary(raw, 0).map((point) => toFrame(point, targetFrame))
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
      const catchDistance = stair.destinationSurfaceId === surface.id ? 1.25 : SNAP_DISTANCE
      if (distance > catchDistance || (closest && distance >= closest.distance)) continue
      const height =
        typeof top.height === 'function'
          ? top.height(raw, { nodes, point: fromFrame(edge, targetFrame) })
          : top.height
      const topElevation =
        targetFrame.y + (surface.position?.[1] ?? 0) + height + floorConstructionLift(nodes, raw)
      const rise = topElevation - (baseElevation + parentFrame.y)
      if (!Number.isFinite(rise) || rise <= 0.01) continue
      const stepCount = Math.max(1, Math.round(rise / 0.16))
      const minRun = stepCount * 0.28
      const length = Math.max(minRun, outside, 0.4)
      const localPoint = fromFrame([edge[0] - nx * length, edge[1] - nz * length], parentFrame)
      closest = {
        distance,
        snap: {
          position: [localPoint[0], candidatePosition[1], localPoint[1]],
          rotation: Math.atan2(nx, nz) - parentFrame.rotation,
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

type SurfaceFrame = {
  x: number
  y: number
  z: number
  rotation: number
  levelId: string | null | undefined
}

function surfaceFrame(
  parentId: string | null | undefined,
  nodes: Readonly<Record<string, AnyNode>>,
): SurfaceFrame {
  const frame: SurfaceFrame = { x: 0, y: 0, z: 0, rotation: 0, levelId: parentId }
  const visited = new Set<string>()
  while (frame.levelId && !visited.has(frame.levelId)) {
    visited.add(frame.levelId)
    const parent = nodes[frame.levelId]
    if (!parent || parent.type === 'level') break
    const pose = parent as AnyNode & {
      position?: [number, number, number]
      rotation?: number | [number, number, number]
    }
    const angle = typeof pose.rotation === 'number' ? pose.rotation : (pose.rotation?.[1] ?? 0)
    const c = Math.cos(angle),
      s = Math.sin(angle)
    const [x, y, z] = pose.position ?? [0, 0, 0]
    const nextX = x + frame.x * c + frame.z * s
    frame.z = z - frame.x * s + frame.z * c
    frame.x = nextX
    frame.y += y
    frame.rotation += angle
    frame.levelId = parent.parentId
  }
  return frame
}

function toFrame([x, z]: readonly [number, number], frame: SurfaceFrame): Point {
  const c = Math.cos(frame.rotation),
    s = Math.sin(frame.rotation)
  return [frame.x + x * c + z * s, frame.z - x * s + z * c]
}
function fromFrame([x, z]: Point, frame: SurfaceFrame): Point {
  const c = Math.cos(frame.rotation),
    s = Math.sin(frame.rotation)
  return [(x - frame.x) * c - (z - frame.z) * s, (x - frame.x) * s + (z - frame.z) * c]
}

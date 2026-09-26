import { getLevelElevations, getWallCurveFrameAt } from '@pascal-app/core'
import {
  composeFrames,
  type Frame,
  frame,
  IDENTITY_FRAME,
  nodeLevelFrame,
  transformPoint,
} from '@pascal-app/core/procedural-items'
import { type AnyNode, type AnyNodeId, getRoofSegmentSurfaceY } from '@pascal-app/core/schema'
import type { Vec3 } from './geometry'
import { computeSegmentTransforms } from './scene-query'

type Nodes = Readonly<Record<string, AnyNode>>

function isVec3(value: unknown): value is Vec3 {
  return (
    Array.isArray(value) &&
    value.length >= 3 &&
    value.slice(0, 3).every((v) => typeof v === 'number' && Number.isFinite(v))
  )
}

function boundsCentre(points: readonly Vec3[]): Vec3 | null {
  if (points.length === 0) return null
  const min: Vec3 = [Infinity, Infinity, Infinity]
  const max: Vec3 = [-Infinity, -Infinity, -Infinity]
  for (const p of points) {
    for (let i = 0; i < 3; i++) {
      min[i] = Math.min(min[i]!, p[i]!)
      max[i] = Math.max(max[i]!, p[i]!)
    }
  }
  return [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2]
}

function polygonCentre(polygon: unknown, y: number): Vec3 | null {
  if (!Array.isArray(polygon) || polygon.length === 0) return null
  let cx = 0
  let cz = 0
  for (const point of polygon as Array<[number, number]>) {
    cx += point[0]
    cz += point[1]
  }
  return [cx / polygon.length, y, cz / polygon.length]
}

/** An anchor that is a tuple or a `{ fallback }` feature reference (measurements, dimensions). */
function anchorPoint(anchor: unknown): Vec3 | null {
  if (isVec3(anchor)) return anchor
  const fallback = (anchor as { fallback?: unknown } | null)?.fallback
  return isVec3(fallback) ? fallback : null
}

/**
 * Centre of the geometry a node stores in its own frame, before its transform:
 * mesh vertices, a segment, a path, a polygon or measurement anchors.
 */
function ownGeometryCentre(node: AnyNode): Vec3 | null {
  const n = node as Record<string, unknown>
  if (node.type === 'block') {
    return boundsCentre(node.topology.vertices.map((v) => v.position as Vec3))
  }
  if (node.type === 'imported-mesh') {
    const points: Vec3[] = []
    for (const primitive of node.primitives) {
      for (let i = 0; i + 2 < primitive.positions.length; i += 3) {
        points.push([
          primitive.positions[i]!,
          primitive.positions[i + 1]!,
          primitive.positions[i + 2]!,
        ])
      }
    }
    return boundsCentre(points)
  }
  if (node.type === 'slab') return polygonCentre(node.polygon, node.elevation ?? 0)
  if (node.type === 'site') return polygonCentre(node.polygon?.points, 0)
  if (Array.isArray(n.polygon)) return polygonCentre(n.polygon, 0)
  if (Array.isArray(n.start) && Array.isArray(n.end)) {
    const [x1, z1] = n.start as [number, number]
    const [x2, z2] = n.end as [number, number]
    return [(x1 + x2) / 2, 0, (z1 + z2) / 2]
  }
  if (Array.isArray(n.path)) return boundsCentre((n.path as unknown[]).filter(isVec3))
  const anchors =
    node.type === 'measurement'
      ? (node.measurement as { points?: unknown[] }).points
      : node.type === 'construction-dimension'
        ? node.anchors
        : undefined
  if (Array.isArray(anchors)) {
    return boundsCentre(anchors.map(anchorPoint).filter((p): p is Vec3 => p !== null))
  }
  return null
}

/**
 * Stair segments render at the attachment chain, not at their stored
 * `position`, so resolve them from the stair frame like the stair system does.
 */
function stairSegmentFrame(node: AnyNode & { type: 'stair-segment' }, nodes: Nodes): Frame | null {
  const stair = node.parentId ? nodes[node.parentId] : undefined
  if (stair?.type !== 'stair') return null
  const segments = (stair.children ?? [])
    .map((id) => nodes[id])
    .filter((n): n is AnyNode & { type: 'stair-segment' } => n?.type === 'stair-segment')
  const index = segments.findIndex((segment) => segment.id === node.id)
  const transform = computeSegmentTransforms(segments)[index]
  if (!transform) return null
  return composeFrames(
    nodeLevelFrame(stair.id, nodes),
    frame(transform.position, [0, transform.rotation, 0]),
  )
}

/**
 * The node's reference point in its level's frame (or in world space when it
 * has no level ancestor), or null for a container with no geometry of its own.
 */
function levelLocalPoint(node: AnyNode, nodes: Nodes): Vec3 | null {
  if (node.type === 'wall') {
    const { point } = getWallCurveFrameAt(node, 0.5)
    return [point.x, nodeLevelFrame(node.id, nodes).position[1], point.y]
  }
  if (node.type === 'stair-segment') {
    const segmentFrame = stairSegmentFrame(node, nodes)
    if (segmentFrame) return segmentFrame.position
  }
  const parent = node.parentId ? nodes[node.parentId] : undefined
  if (
    (node.type === 'solar-panel' || node.type === 'skylight') &&
    parent?.type === 'roof-segment'
  ) {
    // Both renderers ignore the stored Y and sit on the roof surface.
    const [x, , z] = node.position
    return transformPoint(nodeLevelFrame(parent.id, nodes), [
      x,
      getRoofSegmentSurfaceY(parent, x, z),
      z,
    ])
  }
  const own = nodeLevelFrame(node.id, nodes)
  const geometry = ownGeometryCentre(node)
  if (geometry) return transformPoint(own, geometry)
  if (isVec3((node as { position?: unknown }).position)) return own.position
  return null
}

function nearestLevelId(node: AnyNode, nodes: Nodes): string | null {
  const seen = new Set<string>()
  let current: AnyNode | undefined = node
  while (current && !seen.has(current.id)) {
    if (current.type === 'level') return current.id
    seen.add(current.id)
    current = current.parentId ? nodes[current.parentId] : undefined
  }
  return null
}

function hostOf(id: string, nodes: Nodes): AnyNode | undefined {
  const node = nodes[id]
  if (node?.parentId) return nodes[node.parentId]
  // The default scene links site → building → level through `children` only.
  return Object.values(nodes).find(
    (candidate) =>
      'children' in candidate &&
      Array.isArray(candidate.children) &&
      (candidate.children as unknown[]).some(
        (child) => child === id || (child as { id?: unknown } | null)?.id === id,
      ),
  )
}

/** A level's frame in world space: its building's transform, then its stacked base Y. */
function levelWorldFrame(levelId: string, nodes: Nodes): Frame {
  const baseY = getLevelElevations(nodes as Record<AnyNodeId, AnyNode>).get(levelId)?.baseY ?? 0
  const host = hostOf(levelId, nodes)
  const hostFrame = host ? nodeLevelFrame(host.id, nodes) : IDENTITY_FRAME
  return composeFrames(hostFrame, frame([0, baseY, 0]))
}

function childIdsOf(id: string, nodes: Nodes): string[] {
  const node = nodes[id]
  const ids = new Set<string>()
  if (node && 'children' in node && Array.isArray(node.children)) {
    for (const child of node.children as unknown[]) {
      const childId = typeof child === 'string' ? child : (child as { id?: unknown } | null)?.id
      if (typeof childId === 'string') ids.add(childId)
    }
  }
  if (node?.type === 'unit') for (const member of node.members) ids.add(member)
  for (const candidate of Object.values(nodes)) {
    if (candidate.parentId === id) ids.add(candidate.id)
  }
  return [...ids].filter((childId) => nodes[childId])
}

/**
 * World-space reference point of any node, following the frames the viewer
 * renders it in (core's `nodeLevelFrame`, the level's stacked base Y and its
 * building transform):
 * - a positioned node: its origin (an item's or column's base, a door's or
 *   window's centre), inside its host's frame;
 * - a wall, fence or grid line: its midpoint at its base;
 * - a slab, ceiling, zone or site: its polygon centroid on its own plane;
 * - a block or imported mesh: the centre of its vertex bounds;
 * - a path or measurement: the centre of its points;
 * - a level: the plan centre of its content on its base plane;
 * - another container (a unit, …): the centre of its descendants' points,
 *   or its origin when it has none.
 */
export function resolveNodeWorldPoint(id: string, nodes: Nodes, depth = 0): Vec3 | null {
  const node = nodes[id]
  if (!node || depth > 32) return null
  if (node.type === 'level') {
    return transformPoint(levelWorldFrame(node.id, nodes), levelPlanCentre(node.id, nodes))
  }
  const levelId = nearestLevelId(node, nodes)
  const toWorld = (point: Vec3) =>
    levelId ? transformPoint(levelWorldFrame(levelId, nodes), point) : point

  const local = levelLocalPoint(node, nodes)
  if (local) return toWorld(local)

  const points = childIdsOf(id, nodes)
    .map((childId) => resolveNodeWorldPoint(childId, nodes, depth + 1))
    .filter((p): p is Vec3 => p !== null)
  if (points.length > 0) return boundsCentre(points)
  return toWorld(nodeLevelFrame(node.id, nodes).position)
}

/**
 * A level's plan centre on its base plane: the centre of its direct children's
 * level-local points. Read from their stored geometry and own transform only,
 * because resolving every wall's slab support makes a large level take seconds.
 */
function levelPlanCentre(levelId: string, nodes: Nodes): Vec3 {
  const points: Vec3[] = []
  for (const childId of childIdsOf(levelId, nodes)) {
    const child = nodes[childId]!
    const transform = child as { position?: unknown; rotation?: unknown }
    const position = isVec3(transform.position) ? transform.position : ([0, 0, 0] as Vec3)
    const rotation: Vec3 =
      typeof transform.rotation === 'number'
        ? [0, transform.rotation, 0]
        : isVec3(transform.rotation)
          ? transform.rotation
          : [0, 0, 0]
    const geometry = ownGeometryCentre(child)
    if (geometry) points.push(transformPoint(frame(position, rotation), geometry))
    else if (isVec3(transform.position)) points.push(position)
  }
  const centre = boundsCentre(points)
  return centre ? [centre[0], 0, centre[2]] : [0, 0, 0]
}

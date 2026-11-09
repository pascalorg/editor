/**
 * Scene bounds in the X/Z plane.
 *
 * Used by the auto-frame hook to fit the camera onto a freshly loaded scene
 * (see `../hooks/use-auto-frame`). The hook subscribes to the core scene
 * store and, when `nodes` transitions from empty → non-empty, fires a
 * `camera-controls:fit-scene` event on the core event bus carrying the
 * computed bounds.
 *
 * This module contains no rendering code: it only walks the flat-dict node
 * tree and derives an axis-aligned bounding box on the XZ (plan) plane.
 */

import { turnPlanPoint, yawOf } from '@pascal-app/core'
import type { AnyNode } from '@pascal-app/core/schema'

export type SceneBoundsXZ = {
  /** Min [x, z] in world units (meters). */
  min: [number, number]
  /** Max [x, z] in world units (meters). */
  max: [number, number]
  /** Center [x, z] = (min + max) / 2. */
  center: [number, number]
  /** Size [w, d] = max - min. */
  size: [number, number]
}

// A very small guard against degenerate bounds (e.g. a single wall of zero length).
const MIN_BOUNDS_EXTENT = 0.0001

/** A node's plan frame in world XZ: local (x, z) → origin + turnPlanPoint(x, z, yaw). */
type PlanFrame = { x: number; z: number; yaw: number }

const WORLD_FRAME: PlanFrame = { x: 0, z: 0, yaw: 0 }

type BoundsAcc = { minX: number; minZ: number; maxX: number; maxZ: number; hasPoint: boolean }

function extendPoint(acc: BoundsAcc, frame: PlanFrame, localX: unknown, localZ: unknown): void {
  if (typeof localX !== 'number' || typeof localZ !== 'number') return
  if (!(Number.isFinite(localX) && Number.isFinite(localZ))) return
  const [tx, tz] = frame.yaw === 0 ? [localX, localZ] : turnPlanPoint(localX, localZ, frame.yaw)
  const x = frame.x + tx
  const z = frame.z + tz
  if (x < acc.minX) acc.minX = x
  if (x > acc.maxX) acc.maxX = x
  if (z < acc.minZ) acc.minZ = z
  if (z > acc.maxZ) acc.maxZ = z
  acc.hasPoint = true
}

/**
 * Compute the axis-aligned XZ bounds of a scene.
 *
 * Walks every node and extracts 2D footprint points from the fields most
 * nodes carry:
 *   - `start`/`end`  → wall and fence endpoints in level coordinates.
 *   - `polygon`      → zone, slab, site-boundary polygons.
 *   - `position`     → building/item/door/window position; uses [x, z] only.
 *
 * Each point is in its parent's frame, so it is carried to world XZ through
 * the ancestors' `position` and `rotation` yaw (a moved or turned building).
 *
 * Site-node polygons are intentionally excluded when they are the default
 * 30×30 bootstrap polygon — otherwise a brand-new empty scene would frame
 * an empty square around the origin. We still include site polygons that
 * look intentional (> 4 points, or any point outside the ±15 m default).
 *
 * Returns `null` if no usable geometry was found.
 */
export function computeSceneBoundsXZ(
  nodes: AnyNode[] | Record<string, AnyNode>,
): SceneBoundsXZ | null {
  const list: AnyNode[] = Array.isArray(nodes) ? nodes : Object.values(nodes)
  if (list.length === 0) return null

  const acc: BoundsAcc = {
    minX: Number.POSITIVE_INFINITY,
    minZ: Number.POSITIVE_INFINITY,
    maxX: Number.NEGATIVE_INFINITY,
    maxZ: Number.NEGATIVE_INFINITY,
    hasPoint: false,
  }

  const byId = new Map<string, AnyNode>()
  for (const node of list) {
    if (node && typeof node === 'object' && typeof node.id === 'string') byId.set(node.id, node)
  }
  const frameOf = createFrameResolver(byId)

  for (const node of list) {
    if (!node || typeof node !== 'object') continue
    const anyNode = node as unknown as Record<string, unknown>
    // A node's own fields live in its parent's frame (a building's walls are
    // building-local), so every point goes through the ancestors' transforms.
    const frame = frameOf(node.parentId ?? null)

    // Wall / fence endpoints in level coordinates.
    const start = anyNode.start as unknown
    const end = anyNode.end as unknown
    if (Array.isArray(start) && start.length >= 2) extendPoint(acc, frame, start[0], start[1])
    if (Array.isArray(end) && end.length >= 2) extendPoint(acc, frame, end[0], end[1])

    // Zone / slab polygons (and explicit polygon-shaped site boundaries).
    const polygon = anyNode.polygon as unknown
    if (Array.isArray(polygon)) {
      // Zones/slabs expose a plain array of [x,z] tuples. Site nodes nest the
      // points under `polygon.points` (a discriminated PropertyLineData shape).
      for (const point of polygon) {
        if (Array.isArray(point) && point.length >= 2) {
          extendPoint(acc, frame, point[0], point[1])
        }
      }
    } else if (
      polygon &&
      typeof polygon === 'object' &&
      Array.isArray((polygon as { points?: unknown }).points)
    ) {
      // Site nodes only: skip the default bootstrap square so a blank scene
      // isn't auto-framed around an empty ±15 m box. Include any other site
      // polygon (more than 4 points, or any coordinate beyond the default).
      const points = (polygon as { points: unknown[] }).points
      if (node.type === 'site' && isDefaultSitePolygon(points)) {
        // Skip — default bootstrap polygon.
      } else {
        for (const point of points) {
          if (Array.isArray(point) && point.length >= 2) {
            extendPoint(acc, frame, point[0], point[1])
          }
        }
      }
    }

    // Position on the XZ plane (3D position = [x, y, z]).
    const position = anyNode.position as unknown
    if (Array.isArray(position) && position.length >= 3) {
      extendPoint(acc, frame, position[0], position[2])
    }
  }

  if (!acc.hasPoint) return null

  // Ensure a minimum extent so a single-point scene still yields a box.
  let minX = acc.minX
  let minZ = acc.minZ
  let maxX = acc.maxX
  let maxZ = acc.maxZ
  if (maxX - minX < MIN_BOUNDS_EXTENT) {
    const cx = (minX + maxX) / 2
    minX = cx - MIN_BOUNDS_EXTENT / 2
    maxX = cx + MIN_BOUNDS_EXTENT / 2
  }
  if (maxZ - minZ < MIN_BOUNDS_EXTENT) {
    const cz = (minZ + maxZ) / 2
    minZ = cz - MIN_BOUNDS_EXTENT / 2
    maxZ = cz + MIN_BOUNDS_EXTENT / 2
  }

  const centerX = (minX + maxX) / 2
  const centerZ = (minZ + maxZ) / 2
  return {
    min: [minX, minZ],
    max: [maxX, maxZ],
    center: [centerX, centerZ],
    size: [maxX - minX, maxZ - minZ],
  }
}

/**
 * World plan frame of each node, composed down the parent chain the way the
 * renderers nest groups: a node with a `position` (building, item) translates
 * its children and turns them by its `rotation` yaw; nodes without one (site,
 * level) pass their parent's frame through.
 */
function createFrameResolver(byId: Map<string, AnyNode>): (id: string | null) => PlanFrame {
  const cache = new Map<string, PlanFrame>()
  const resolving = new Set<string>()

  const resolve = (id: string | null): PlanFrame => {
    if (!id) return WORLD_FRAME
    const cached = cache.get(id)
    if (cached) return cached
    const node = byId.get(id)
    if (!node || resolving.has(id)) return WORLD_FRAME
    resolving.add(id)
    const parent = resolve(node.parentId ?? null)
    resolving.delete(id)

    const anyNode = node as unknown as Record<string, unknown>
    const position = anyNode.position
    let frame = parent
    if (Array.isArray(position) && position.length >= 3) {
      const px = Number.isFinite(position[0]) ? (position[0] as number) : 0
      const pz = Number.isFinite(position[2]) ? (position[2] as number) : 0
      const [tx, tz] = turnPlanPoint(px, pz, parent.yaw)
      frame = { x: parent.x + tx, z: parent.z + tz, yaw: parent.yaw + yawOf(anyNode.rotation) }
    }
    cache.set(id, frame)
    return frame
  }

  return resolve
}

/**
 * Matches the `SiteNode` bootstrap polygon defined in
 * `packages/core/src/schema/nodes/site.ts` (a 30×30 square at the origin).
 * We ignore it so the default scene doesn't "auto-frame" onto an empty box.
 */
function isDefaultSitePolygon(points: unknown[]): boolean {
  if (points.length !== 4) return false
  const expected: [number, number][] = [
    [-15, -15],
    [15, -15],
    [15, 15],
    [-15, 15],
  ]
  for (let i = 0; i < 4; i++) {
    const p = points[i]
    const e = expected[i]!
    if (!Array.isArray(p) || p.length < 2) return false
    if (p[0] !== e[0] || p[1] !== e[1]) return false
  }
  return true
}

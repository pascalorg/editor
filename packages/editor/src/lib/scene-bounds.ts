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

import type { AnyNode } from '@pascal-app/core/schema'
import { at } from './typed-access'

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

function extendPoint(
  acc: { minX: number; minZ: number; maxX: number; maxZ: number; hasPoint: boolean },
  x: unknown,
  z: unknown,
): void {
  if (typeof x !== 'number' || typeof z !== 'number') return
  if (!(Number.isFinite(x) && Number.isFinite(z))) return
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

  const acc = {
    minX: Number.POSITIVE_INFINITY,
    minZ: Number.POSITIVE_INFINITY,
    maxX: Number.NEGATIVE_INFINITY,
    maxZ: Number.NEGATIVE_INFINITY,
    hasPoint: false,
  }

  for (const node of list) {
    switch (node.type) {
      // Wall / fence endpoints in level coordinates.
      case 'wall':
      case 'fence': {
        extendPoint(acc, node.start[0], node.start[1])
        extendPoint(acc, node.end[0], node.end[1])
        break
      }

      // Zone / slab / ceiling polygons: a plain array of [x, z] tuples.
      case 'zone':
      case 'slab':
      case 'ceiling': {
        for (const point of node.polygon) {
          extendPoint(acc, point[0], point[1])
        }
        break
      }

      // Site nodes nest their points under `polygon.points`. Skip the default
      // bootstrap square so a blank scene isn't auto-framed around an empty
      // ±15 m box; include any other site polygon.
      case 'site': {
        const points = node.polygon.points
        if (!isDefaultSitePolygon(points)) {
          for (const point of points) {
            extendPoint(acc, point[0], point[1])
          }
        }
        break
      }

      // Position on the XZ plane (3D position = [x, y, z]).
      case 'building':
      case 'item':
      case 'guide':
      case 'column':
      case 'door':
      case 'window':
      case 'elevator':
      case 'stair':
      case 'stair-segment':
      case 'roof':
      case 'roof-segment':
      case 'shelf':
      case 'scan':
      case 'spawn':
      case 'box-vent':
      case 'ridge-vent':
      case 'chimney':
      case 'solar-panel':
      case 'skylight':
      case 'dormer': {
        extendPoint(acc, node.position[0], node.position[2])
        break
      }

      default:
        break
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
    const e = at(expected, i)
    if (!Array.isArray(p) || p.length < 2) return false
    if (p[0] !== e[0] || p[1] !== e[1]) return false
  }
  return true
}

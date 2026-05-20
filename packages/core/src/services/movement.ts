import { nodeRegistry } from '../registry/registry'
import type { MovableConfig } from '../registry/types'
import type { AnyNode } from '../schema/types'
import { snapVec3ToGrid, type Vec3 } from './snap'

/**
 * Pure movement constraint helpers. Given a node and a target position, apply
 * the constraints declared in `def.capabilities.movable` (axis lock, grid
 * snap, override callback) and return the constrained target.
 *
 * No scene access, no React, no Three.js — caller passes the node, this
 * returns the math result.
 */

export type AxisLock = ReadonlyArray<'x' | 'y' | 'z'>

/**
 * Returns the MovableConfig effective for `node` after running its `override`
 * callback if declared. Returns `null` if the node's def doesn't declare
 * `movable` (i.e. the node is not movable).
 */
export function resolveMovable(node: AnyNode): MovableConfig | null {
  const def = nodeRegistry.get(node.type)
  const base = def?.capabilities.movable
  if (!base) return null
  if (base.override) {
    const overridden = base.override({ node })
    return overridden ?? base
  }
  return base
}

/**
 * Projects a target X/Y/Z onto the axes a node is allowed to move on. Components
 * outside the lock fall back to the node's current values, so caller-supplied
 * positions can come from any 3D source without breaking axis-locked motion.
 */
export function applyAxisLock(current: Vec3, target: Vec3, axes: AxisLock): Vec3 {
  return [
    axes.includes('x') ? target[0] : current[0],
    axes.includes('y') ? target[1] : current[1],
    axes.includes('z') ? target[2] : current[2],
  ]
}

/**
 * Top-level helper: takes a node and a desired position, returns the position
 * filtered through the node's movable capability (axis lock + optional grid
 * snap). Returns `null` when the node is not movable.
 */
export function moveToward(
  node: AnyNode,
  current: Vec3,
  target: Vec3,
  options: { gridStep?: number; gridSnap?: boolean } = {},
): Vec3 | null {
  const config = resolveMovable(node)
  if (!config) return null

  let next = applyAxisLock(current, target, config.axes)

  const wantsGridSnap = options.gridSnap ?? config.gridSnap
  if (wantsGridSnap) {
    next = snapVec3ToGrid(next, options.gridStep)
  }

  return next
}

/**
 * 2D convenience: same as moveToward but for plan-view (X/Z) operations like
 * floor placement. Returns a tuple in the X/Z plane so callers don't have to
 * pack/unpack the dropped Y.
 */
export function movePlanToward(
  node: AnyNode,
  currentY: number,
  current: readonly [number, number],
  target: readonly [number, number],
  options: { gridStep?: number; gridSnap?: boolean } = {},
): readonly [number, number] | null {
  const result = moveToward(
    node,
    [current[0], currentY, current[1]],
    [target[0], currentY, target[1]],
    options,
  )
  if (!result) return null
  return [result[0], result[2]]
}

/**
 * Returns true when a node's def declares it as movable on any axis.
 * Quick predicate for tools/UI that gate on movability.
 */
export function isMovable(node: AnyNode): boolean {
  const config = resolveMovable(node)
  return config != null && config.axes.length > 0
}

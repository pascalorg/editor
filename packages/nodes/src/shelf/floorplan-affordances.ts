import {
  type AnyNodeId,
  type FloorplanAffordance,
  type ShelfNode,
  useScene,
} from '@pascal-app/core'
import { rotateAffordanceDelta } from '../shared/rotate-affordance'

// Mirror the 3D handles in `shelf/definition.ts` so a drag can't push a
// value past what the renderer / geometry builder accepts.
const MIN_SHELF_WIDTH = 0.3
const MIN_SHELF_DEPTH = 0.1

export type ShelfResizePayload = {
  dim: 'width' | 'depth'
  // Plan-space direction of the arrow's outward tip. Captured at emit
  // time so a mid-drag rotation can't drift the projection basis.
  planAxis: [number, number]
}

/**
 * Single drag handler for both shelf size arrows. Mirrors the 3D
 * `shelfWidthHandle` / `shelfDepthHandle` (`anchor: 'center'` — cursor
 * delta `d` along the outward axis grows the dimension by `2·d` so both
 * faces move ±d and the centre stays put).
 */
export const shelfResizeAffordance: FloorplanAffordance<ShelfNode> = {
  start({ node, payload, initialPlanPoint }) {
    const { dim, planAxis } = payload as ShelfResizePayload
    const shelfId = node.id as AnyNodeId
    const [ax, ay] = planAxis
    const initialProj = initialPlanPoint[0] * ax + initialPlanPoint[1] * ay
    const initialWidth = node.width
    const initialDepth = node.depth

    let lastPatch: Partial<ShelfNode> = {}

    return {
      affectedIds: [shelfId],
      apply({ planPoint }) {
        const currentProj = planPoint[0] * ax + planPoint[1] * ay
        const projDelta = currentProj - initialProj
        if (dim === 'width') {
          lastPatch = { width: Math.max(MIN_SHELF_WIDTH, initialWidth + 2 * projDelta) }
        } else {
          lastPatch = { depth: Math.max(MIN_SHELF_DEPTH, initialDepth + 2 * projDelta) }
        }
        useScene.getState().updateNode(shelfId, lastPatch)
      },
      canCommit() {
        return true
      },
      commit() {
        if (Object.keys(lastPatch).length > 0) {
          useScene.getState().updateNode(shelfId, lastPatch)
        }
      },
    }
  },
}

/**
 * Whole-shelf rotation drag (floor-plan). Sister to the 3D
 * `shelfRotateHandle` (arc-resize). Cursor angle around the shelf
 * centre drives `rotation[1]` (Y axis). Shelf stores rotation as a
 * `[x, y, z]` tuple — the patch preserves the X / Z slots.
 *
 * Same `- delta` convention as the 3D handle: the floor-plan builder
 * plots the footprint at `-rotation[1]` (see `buildShelfFloorplan`'s
 * `planRy`), so the 2D view rotates the same direction as 3D for the
 * same `rotation` value and the same cursor gesture writes the same
 * sign in both views.
 */
export const shelfRotateAffordance: FloorplanAffordance<ShelfNode> = {
  start({ node, initialPlanPoint }) {
    const shelfId = node.id as AnyNodeId
    const r = node.rotation ?? [0, 0, 0]
    const initialRotationY = r[1] ?? 0
    const cx = node.position[0]
    const cz = node.position[2]
    const initialAngle = Math.atan2(initialPlanPoint[1] - cz, initialPlanPoint[0] - cx)
    let lastRotation: [number, number, number] = [r[0], initialRotationY, r[2]]

    return {
      affectedIds: [shelfId],
      apply({ planPoint, modifiers }) {
        const delta = rotateAffordanceDelta({
          center: [cx, cz],
          initialAngle,
          planPoint,
          free: modifiers.shiftKey,
        })
        const newRotationY = initialRotationY - delta
        lastRotation = [r[0], newRotationY, r[2]]
        useScene.getState().updateNode(shelfId, { rotation: lastRotation })
      },
      canCommit() {
        return true
      },
      commit() {
        useScene.getState().updateNode(shelfId, { rotation: lastRotation })
      },
    }
  },
}

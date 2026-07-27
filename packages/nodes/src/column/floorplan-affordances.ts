import {
  type AnyNodeId,
  type ColumnNode,
  type FloorplanAffordance,
  useLiveNodeOverrides,
  useScene,
} from '@pascal-app/core'
import { isAngleSnapActive } from '@pascal-app/editor'
import { rotateAffordanceDelta } from '../shared/rotate-affordance'

// Floor minimums — mirror the 3D handles in `column/definition.ts` so a
// drag can't push a value past what the renderer accepts.
const MIN_COLUMN_WIDTH = 0.1
const MIN_COLUMN_DEPTH = 0.1
const MIN_COLUMN_RADIUS = 0.05
const MIN_BRACE_DIMENSION = 0.04
const MIN_BRACE_BOTTOM_SPREAD = 0.2
const MIN_BRACE_TOP_SPREAD = 0

/**
 * One drag pattern for every column size handle. The arrow's outward
 * direction in plan coords (`planAxis`) is captured at emit-time; the
 * affordance projects the cursor along that axis and applies the delta
 * to the dimension named by `dim`.
 *
 * Sign / factor mirror the 3D `column/definition.ts` handles:
 *
 *   - `width` / `depth` / `uniform` / `brace-width` / `brace-depth` /
 *     `brace-bottom-spread` / `brace-top-spread`: `anchor: 'center'` —
 *     a cursor delta of `d` along the outward axis grows the dimension
 *     by `2·d` (both faces move ±d so the centre stays put).
 *   - `radius`: `kind: 'radial-resize'` — cursor delta `d` grows the
 *     radius by `d` (the visible edge follows the cursor 1:1).
 */
export type ColumnResizePayload = {
  dim:
    | 'width'
    | 'depth'
    | 'uniform'
    | 'radius'
    | 'brace-width'
    | 'brace-depth'
    | 'brace-bottom-spread'
    | 'brace-top-spread'
  planAxis: [number, number]
}

export const columnResizeAffordance: FloorplanAffordance<ColumnNode> = {
  start({ node, payload, initialPlanPoint }) {
    const { dim, planAxis } = payload as ColumnResizePayload
    const columnId = node.id as AnyNodeId
    const [ax, ay] = planAxis
    const initialProj = initialPlanPoint[0] * ax + initialPlanPoint[1] * ay
    const initialWidth = node.width
    const initialDepth = node.depth
    const initialRadius = node.radius
    const initialBraceWidth = node.braceWidth ?? node.width
    const initialBraceDepth = node.braceDepth ?? node.depth
    const initialBraceBottomSpread = node.braceBottomSpread ?? Math.max(node.width * 3, 1.2)
    const initialBraceTopSpread = node.braceTopSpread ?? 0.12

    let lastPatch: Partial<ColumnNode> = {}

    const previewPatch = (patch: Partial<ColumnNode>) => {
      lastPatch = patch
      useLiveNodeOverrides.getState().set(columnId, patch)
      useScene.getState().markDirty(columnId)
    }

    return {
      affectedIds: [columnId],
      apply({ planPoint }) {
        const currentProj = planPoint[0] * ax + planPoint[1] * ay
        const projDelta = currentProj - initialProj
        switch (dim) {
          case 'width':
            previewPatch({
              width: Math.max(MIN_COLUMN_WIDTH, initialWidth + 2 * projDelta),
            })
            return
          case 'depth':
            previewPatch({
              depth: Math.max(MIN_COLUMN_DEPTH, initialDepth + 2 * projDelta),
            })
            return
          case 'uniform': {
            const next = Math.max(MIN_COLUMN_WIDTH, initialWidth + 2 * projDelta)
            previewPatch({ width: next, depth: next })
            return
          }
          case 'radius':
            previewPatch({
              radius: Math.max(MIN_COLUMN_RADIUS, initialRadius + projDelta),
            })
            return
          case 'brace-width':
            previewPatch({
              braceWidth: Math.max(MIN_BRACE_DIMENSION, initialBraceWidth + 2 * projDelta),
            })
            return
          case 'brace-depth':
            previewPatch({
              braceDepth: Math.max(MIN_BRACE_DIMENSION, initialBraceDepth + 2 * projDelta),
            })
            return
          case 'brace-bottom-spread':
            previewPatch({
              braceBottomSpread: Math.max(
                MIN_BRACE_BOTTOM_SPREAD,
                initialBraceBottomSpread + 2 * projDelta,
              ),
            })
            return
          case 'brace-top-spread':
            previewPatch({
              braceTopSpread: Math.max(MIN_BRACE_TOP_SPREAD, initialBraceTopSpread + 2 * projDelta),
            })
            return
        }
      },
      canCommit() {
        return true
      },
      commit() {
        if (Object.keys(lastPatch).length > 0) {
          useLiveNodeOverrides.getState().clear(columnId)
          useScene.getState().updateNode(columnId, lastPatch)
        }
      },
    }
  },
}

/**
 * Column rotation drag (floor-plan). Sister to the 3D
 * `columnRotateHandle` (arc-resize). Same `- delta` convention as the
 * 3D handle: the floor-plan builder plots the footprint at
 * `-column.rotation` (see `buildColumnFloorplan`'s `rot = -node.rotation`),
 * so the 2D view rotates the same direction as 3D for the same
 * `rotation` value, and the same cursor gesture writes the same sign
 * in both views.
 */
export const columnRotateAffordance: FloorplanAffordance<ColumnNode> = {
  start({ node, initialPlanPoint }) {
    const columnId = node.id as AnyNodeId
    const initialRotation = node.rotation ?? 0
    const cx = node.position[0]
    const cz = node.position[2]
    const initialAngle = Math.atan2(initialPlanPoint[1] - cz, initialPlanPoint[0] - cx)
    let lastRotation = initialRotation

    return {
      affectedIds: [columnId],
      apply({ planPoint }) {
        const delta = rotateAffordanceDelta({
          center: [cx, cz],
          initialAngle,
          planPoint,
          free: !isAngleSnapActive(),
        })
        const newRotation = initialRotation - delta
        lastRotation = newRotation
        useLiveNodeOverrides.getState().set(columnId, { rotation: newRotation })
        useScene.getState().markDirty(columnId)
      },
      canCommit() {
        return true
      },
      commit() {
        useLiveNodeOverrides.getState().clear(columnId)
        useScene.getState().updateNode(columnId, { rotation: lastRotation })
      },
    }
  },
}

import {
  type AnyNode,
  type AnyNodeId,
  type DragAction,
  type FenceNode,
  getClampedWallCurveOffset,
  getMaxWallCurveOffset,
  getWallChordFrame,
  normalizeWallCurveOffset,
} from '@pascal-app/core'

/**
 * Phase 5 Stage D — curve-fence drag affordance.
 *
 * Migrates `CurveFenceTool` (editor/tools/fence/curve-fence-tool.tsx,
 * 178 LoC) to the `DragAction` primitive. The pure action lives in the
 * fence node folder; a thin React wrapper (curve-tool.tsx) feeds it
 * through `useDragAction`.
 *
 * The lifecycle:
 *  - **begin**: capture the node id + original curveOffset + chord +
 *    maxOffset + grid step. These never change during the drag.
 *  - **preview**: convert the pointer's level-local point into a
 *    distance along the chord's normal — that's the curveOffset.
 *  - **snap**: optional grid snap unless `modifiers.shift` (free place).
 *  - **apply**: write the new curveOffset onto the fence node. Returns
 *    the dirty IDs the cascade resolver should walk.
 *  - **commit**: single-undo dance — `restoreAll` → `resumeHistory` →
 *    re-apply final draft so zundo captures the whole drag as one
 *    Ctrl-Z step. Rejected when the offset didn't actually change.
 *  - **cancel**: no-op — `createDragSession.cancel()` calls
 *    `scene.restoreAll()` via the snapshot.
 *
 * Pure data: trivially unit-testable, doesn't import React.
 */

type CurveFenceCtx = {
  nodeId: AnyNodeId
  originalCurveOffset: number
  chord: ReturnType<typeof getWallChordFrame>
  maxCurveOffset: number
  // Snapshot of the node at drag start — used to recompute the curve frame
  // and normalize the offset throughout the drag.
  startNode: FenceNode
}

type CurveFenceDraft = {
  curveOffset: number
}

export const curveFenceDragAction: DragAction<CurveFenceCtx, CurveFenceDraft> = {
  begin: (input) => {
    const node = input.node as FenceNode | undefined
    if (!node) {
      throw new Error('[curveFenceDragAction] begin requires a node')
    }
    return {
      nodeId: node.id as AnyNodeId,
      originalCurveOffset: getClampedWallCurveOffset(node),
      chord: getWallChordFrame(node),
      maxCurveOffset: getMaxWallCurveOffset(node),
      startNode: node,
    }
  },

  preview: (ctx, point) => {
    // Pointer in level-local meters. Project onto the chord's normal to
    // get the signed perpendicular distance — that's the new curveOffset.
    const [px, pz] = point
    const offset = -(
      (px - ctx.chord.midpoint.x) * ctx.chord.normal.x +
      (pz - ctx.chord.midpoint.y) * ctx.chord.normal.y
    )
    return { curveOffset: offset }
  },

  snap: (draft, ctx, _services) => {
    // Clamp to maxCurveOffset and normalize via the wall-curve helper.
    const clamped = Math.max(-ctx.maxCurveOffset, Math.min(ctx.maxCurveOffset, draft.curveOffset))
    const normalized = normalizeWallCurveOffset(ctx.startNode, clamped)
    return { curveOffset: normalized }
  },

  apply: (draft, ctx, scene) => {
    scene.update(ctx.nodeId, { curveOffset: draft.curveOffset } as Partial<AnyNode>)
    scene.markDirty(ctx.nodeId)
    return [ctx.nodeId]
  },

  commit: (draft, ctx, scene) => {
    // Single-undo dance — ALWAYS push a pastState entry, even when the
    // offset didn't actually change. The "no-op" case (small drag that
    // `normalizeWallCurveOffset` snaps back to 0) used to return false
    // here, but that bypassed pastStates entirely; the next Ctrl-Z then
    // fell through to whatever was on the stack before activation
    // (typically the fence creation), making it look like the bend
    // cancelled the create.
    //
    // Pushing on every commit means a no-op bend's first Ctrl-Z absorbs
    // a silent entry (no visible change), then subsequent Ctrl-Z's roll
    // back the real prior actions. Matches typical editor behavior.
    scene.restoreAll()
    scene.resumeHistory()
    scene.update(ctx.nodeId, { curveOffset: draft.curveOffset } as Partial<AnyNode>)
    return true
  },

  cancel: (_ctx, _scene) => {
    // No-op — createDragSession.cancel() calls scene.restoreAll() which
    // puts every touched node back via the snapshot.
  },
}

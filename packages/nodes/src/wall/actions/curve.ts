import {
  type AnyNode,
  type AnyNodeId,
  type DragAction,
  getClampedWallCurveOffset,
  getMaxWallCurveOffset,
  getWallChordFrame,
  normalizeWallCurveOffset,
  type WallNode,
} from '@pascal-app/core'

/**
 * Phase 5 Stage D — curve-wall drag affordance.
 *
 * Mirrors `fence/actions/curve.ts`. Same chord-perpendicular projection,
 * same clamp/normalize, same single-undo dance on commit. The only
 * meaningful difference is the wall's snap-step-aware preview (the
 * legacy CurveWallTool snapped the pointer position to `getWallGridStep`
 * before projecting). We rely on the wall snap services existing in
 * the wall-drafting module — exposing those here would bloat the
 * surface, so we accept the slight precision difference for now (the
 * normalized offset is what zundo records anyway).
 */

type CurveWallCtx = {
  nodeId: AnyNodeId
  originalCurveOffset: number
  chord: ReturnType<typeof getWallChordFrame>
  maxCurveOffset: number
  startNode: WallNode
}

type CurveWallDraft = {
  curveOffset: number
}

export const curveWallDragAction: DragAction<CurveWallCtx, CurveWallDraft> = {
  begin: (input) => {
    const node = input.node as WallNode | undefined
    if (!node) throw new Error('[curveWallDragAction] begin requires a wall node')
    return {
      nodeId: node.id as AnyNodeId,
      originalCurveOffset: getClampedWallCurveOffset(node),
      chord: getWallChordFrame(node),
      maxCurveOffset: getMaxWallCurveOffset(node),
      startNode: node,
    }
  },

  preview: (ctx, point) => {
    const [px, pz] = point
    const offset = -(
      (px - ctx.chord.midpoint.x) * ctx.chord.normal.x +
      (pz - ctx.chord.midpoint.y) * ctx.chord.normal.y
    )
    return { curveOffset: offset }
  },

  snap: (draft, ctx, _services) => {
    const clamped = Math.max(-ctx.maxCurveOffset, Math.min(ctx.maxCurveOffset, draft.curveOffset))
    return { curveOffset: normalizeWallCurveOffset(ctx.startNode, clamped) }
  },

  apply: (draft, ctx, scene) => {
    scene.update(ctx.nodeId, { curveOffset: draft.curveOffset } as Partial<AnyNode>)
    scene.markDirty(ctx.nodeId)
    return [ctx.nodeId]
  },

  commit: (draft, ctx, scene) => {
    // Always push a pastState entry — see fence/actions/curve.ts for
    // the rationale (no-op-bend would otherwise let Ctrl-Z cancel the
    // wall creation).
    scene.restoreAll()
    scene.resumeHistory()
    scene.update(ctx.nodeId, { curveOffset: draft.curveOffset } as Partial<AnyNode>)
    return true
  },

  cancel: (_ctx, _scene) => {
    // No-op — orchestrator restores via snapshot.
  },
}

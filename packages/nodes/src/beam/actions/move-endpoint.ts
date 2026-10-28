import {
  type AnyNode,
  type AnyNodeId,
  type BeamNode,
  type DragAction,
  useScene,
} from '@pascal-app/core'
import { isSegmentLongEnough, type WallPlanPoint } from '@pascal-app/editor'
import { snapBeamPoint } from '../drafting'

export type MoveBeamEndpointCtx = {
  beamId: AnyNodeId
  endpoint: 'start' | 'end'
  levelId: string | null
  /** The end that stays put. */
  fixed: WallPlanPoint
}

export type MoveBeamEndpointDraft = { start: WallPlanPoint; end: WallPlanPoint }

/**
 * A beam's end dragged in 3D, as a pure drag action:
 *  - **preview**: the pointer snapped as the beam tool snaps (wall faces and ends, other beams,
 *    post centres, the grid), angle-stepped off the end that stays; Alt places it freely.
 *  - **apply**: writes the ends into the scene while history is paused.
 *  - **commit**: refuses a beam too short to draw; otherwise reverts, resumes history and writes
 *    the final ends once, so the drag is one undo step.
 *  - **cancel**: `createDragSession` restores the beam it touched.
 */
export const moveBeamEndpointDragAction: DragAction<MoveBeamEndpointCtx, MoveBeamEndpointDraft> = {
  begin: (input) => {
    const beam = input.node as BeamNode | undefined
    if (beam?.type !== 'beam') throw new Error('[moveBeamEndpointDragAction] begin requires a beam')
    const endpoint = input.handleId === 'start' ? 'start' : 'end'
    return {
      beamId: beam.id as AnyNodeId,
      endpoint,
      levelId: beam.parentId ?? null,
      fixed: endpoint === 'start' ? [beam.end[0], beam.end[1]] : [beam.start[0], beam.start[1]],
    }
  },

  preview: (ctx, point, modifiers) => {
    const moved: WallPlanPoint = ctx.levelId
      ? snapBeamPoint({
          point: [point[0], point[1]],
          nodes: useScene.getState().nodes,
          levelId: ctx.levelId,
          start: ctx.fixed,
          ignoreIds: [ctx.beamId],
          free: modifiers.alt,
        }).point
      : [point[0], point[1]]
    return ctx.endpoint === 'start'
      ? { start: moved, end: ctx.fixed }
      : { start: ctx.fixed, end: moved }
  },

  apply: (draft, ctx, scene) => {
    scene.update(ctx.beamId, { start: draft.start, end: draft.end } as Partial<AnyNode>)
    return [ctx.beamId]
  },

  commit: (draft, ctx, scene) => {
    if (!(draft && isSegmentLongEnough(draft.start, draft.end))) return false
    scene.restoreAll()
    scene.resumeHistory()
    scene.update(ctx.beamId, { start: draft.start, end: draft.end } as Partial<AnyNode>)
    return true
  },

  cancel: () => {},
}

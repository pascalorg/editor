import {
  type AlignmentAnchor,
  type AnyNode,
  type AnyNodeId,
  collectAlignmentAnchors,
  type DragAction,
  type FenceNode,
  resolveAlignment,
  useScene,
  type WallNode,
} from '@pascal-app/core'
import {
  type FencePlanPoint,
  isAlignmentGuideActive,
  isAngleSnapActive,
  isMagneticSnapActive,
  isSegmentLongEnough,
  snapFenceDraftPoint,
  useAlignmentGuides,
} from '@pascal-app/editor'
import type { BeamNode } from '../schema'

/**
 * Move-beam-endpoint drag affordance.
 *
 * A beam is a centreline element: dragging one endpoint reshapes the span,
 * the other endpoint stays put. Same orchestration shape as the fence's
 * action — snapshot originals, snap the pointer (grid + angle + magnetic +
 * alignment), publish the draft, single-undo dance on commit — but stripped
 * of the fence's linked-endpoint cascade and support-slab election: beams
 * don't share endpoints by relation and run no lift host.
 *
 * Pure data — no React, no DOM. Tests drive it through `createDragSession`
 * with a stub `SceneApi` + a `useScene` fixture.
 */

const ALIGNMENT_THRESHOLD_M = 0.08

export type MoveBeamEndpointCtx = {
  beamId: AnyNodeId
  endpoint: 'start' | 'end'
  originalStart: FencePlanPoint
  originalEnd: FencePlanPoint
  originalMovingPoint: FencePlanPoint
  fixedPoint: FencePlanPoint
  /** Snap targets at the parent level — walls + fences (beams themselves
   *  are the dragged segment and aren't in the snap pipeline's union). */
  levelWalls: WallNode[]
  levelFences: FenceNode[]
  /** Alignment anchors (endpoints + midpoints) of every OTHER node on the
   *  level (building-local), feeding the resolver. */
  alignCandidates: AlignmentAnchor[]
}

export type MoveBeamEndpointDraft = {
  movingPoint: FencePlanPoint
  start: FencePlanPoint
  end: FencePlanPoint
}

export const moveBeamEndpointDragAction: DragAction<MoveBeamEndpointCtx, MoveBeamEndpointDraft> = {
  begin: (input) => {
    const beam = input.node as BeamNode | undefined
    if (!beam) throw new Error('[moveBeamEndpointDragAction] begin requires a beam node')
    const endpoint = (input.handleId ?? 'end') as 'start' | 'end'
    const parentId = beam.parentId ?? null
    const originalStart: FencePlanPoint = [beam.start[0], beam.start[1]]
    const originalEnd: FencePlanPoint = [beam.end[0], beam.end[1]]
    const originalMovingPoint = endpoint === 'start' ? originalStart : originalEnd
    const fixedPoint = endpoint === 'start' ? originalEnd : originalStart

    const { nodes } = useScene.getState()
    const levelWalls: WallNode[] = []
    const levelFences: FenceNode[] = []
    for (const node of Object.values(nodes)) {
      if (!node) continue
      if ((node.parentId ?? null) !== parentId) continue
      if (node.type === 'wall') levelWalls.push(node)
      else if (node.type === 'fence') levelFences.push(node)
    }

    const alignCandidates = collectAlignmentAnchors(useScene.getState().nodes, beam.id)

    return {
      beamId: beam.id as AnyNodeId,
      endpoint,
      originalStart,
      originalEnd,
      originalMovingPoint,
      fixedPoint,
      levelWalls,
      levelFences,
      alignCandidates,
    }
  },

  preview: (ctx, point, modifiers) => {
    const planPoint: FencePlanPoint = [point[0], point[1]]
    const snapped = snapFenceDraftPoint({
      point: planPoint,
      walls: ctx.levelWalls,
      fences: ctx.levelFences,
      ignoreFenceIds: [ctx.beamId as string],
      start: ctx.fixedPoint,
      angleSnap: isAngleSnapActive(),
      magnetic: isMagneticSnapActive(),
    })

    // Figma-style alignment — same as the fence action: nudge the dragged
    // endpoint onto another node's endpoint / midpoint axis when within
    // threshold and publish a guide. Alt is not reserved for anything on a
    // beam (no cascade to detach), so it behaves as plain bypass.
    let aligned = snapped
    if (isAlignmentGuideActive() && ctx.alignCandidates.length > 0) {
      const ar = resolveAlignment({
        moving: [{ nodeId: ctx.beamId as string, kind: 'corner', x: snapped[0], z: snapped[1] }],
        candidates: ctx.alignCandidates,
        threshold: ALIGNMENT_THRESHOLD_M,
      })
      if (ar.snap && isMagneticSnapActive()) {
        aligned = [snapped[0] + ar.snap.dx, snapped[1] + ar.snap.dz]
      }
      useAlignmentGuides.getState().set(ar.guides)
    } else {
      useAlignmentGuides.getState().clear()
    }

    return {
      movingPoint: aligned,
      start: ctx.endpoint === 'start' ? aligned : ctx.fixedPoint,
      end: ctx.endpoint === 'end' ? aligned : ctx.fixedPoint,
    }
  },

  apply: (draft, ctx, scene) => {
    scene.update(ctx.beamId, { start: draft.start, end: draft.end } as Partial<AnyNode>)
    return [ctx.beamId]
  },

  commit: (draft, ctx, scene) => {
    useAlignmentGuides.getState().clear()
    if (!isSegmentLongEnough(draft.start, draft.end)) return false

    // Single-undo dance: revert to originals (paused history → no zundo
    // record), resume history, then re-apply the final draft so zundo
    // captures the entire drag as one undo step.
    scene.restoreAll()
    scene.resumeHistory()
    scene.update(ctx.beamId, { start: draft.start, end: draft.end } as Partial<AnyNode>)
    return true
  },

  cancel: (_ctx, _scene) => {
    useAlignmentGuides.getState().clear()
    // No-op otherwise — createDragSession.cancel() calls scene.restoreAll()
    // which puts every touched node back via the snapshot.
  },
}

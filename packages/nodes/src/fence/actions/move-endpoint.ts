import {
  type AnyNode,
  type AnyNodeId,
  type DragAction,
  type FenceNode,
  useScene,
  type WallNode,
} from '@pascal-app/core'
import { type FencePlanPoint, isWallLongEnough, snapFenceDraftPoint } from '@pascal-app/editor'

/**
 * Phase 5 Stage D — move-fence-endpoint drag affordance.
 *
 * Pure orchestration of an endpoint drag:
 *  - **begin**: snapshot originals (start / end / moving point / fixed
 *    point), look up linked fences (any other fence in the same parent
 *    whose start or end matches the moving point at activation time),
 *    cache walls + fences at the level for snap targets.
 *  - **preview**: snap the pointer (grid + 45° angle + wall/fence corner
 *    + span snaps via `snapFenceDraftPoint`), compute next start / end
 *    and the cascade of linked fence endpoint updates. Alt-key detaches
 *    the cascade for this tick (legacy "detach endpoint" semantics).
 *  - **apply**: writes the fence + linked fence endpoints into the
 *    scene. Drag-session paused history captures originals; cascade
 *    resolver fans dirty marks through `endpoint-match`.
 *  - **commit**: requires `hasChanged` && `isWallLongEnough(next)`.
 *    Performs the single-undo dance — revert to originals (snapshot),
 *    resume history, re-apply final draft — so the entire drag is one
 *    `Ctrl-Z` step. Returns false to reject; `createDragSession.cancel`
 *    restores all touched nodes.
 *  - **cancel**: nothing to do — `createDragSession.cancel`'s built-in
 *    `scene.restoreAll()` puts every touched node back.
 *
 * Pure data — no React, no DOM. Tests drive it through
 * `createDragSession` with a stub `SceneApi` + a `useScene` fixture
 * pre-populated by the test.
 */

const LINKED_FENCE_ENDPOINT_EPSILON = 0.025

function samePoint(a: FencePlanPoint, b: FencePlanPoint): boolean {
  return (
    Math.abs(a[0] - b[0]) <= LINKED_FENCE_ENDPOINT_EPSILON &&
    Math.abs(a[1] - b[1]) <= LINKED_FENCE_ENDPOINT_EPSILON
  )
}

type LinkedFenceSnapshot = {
  id: FenceNode['id']
  start: FencePlanPoint
  end: FencePlanPoint
}

export type MoveFenceEndpointCtx = {
  fenceId: AnyNodeId
  endpoint: 'start' | 'end'
  originalStart: FencePlanPoint
  originalEnd: FencePlanPoint
  originalMovingPoint: FencePlanPoint
  fixedPoint: FencePlanPoint
  parentId: string | null
  linkedOriginals: LinkedFenceSnapshot[]
  levelWalls: WallNode[]
  levelFences: FenceNode[]
}

export type MoveFenceEndpointDraft = {
  movingPoint: FencePlanPoint
  start: FencePlanPoint
  end: FencePlanPoint
  linkedUpdates: LinkedFenceSnapshot[]
  detached: boolean
}

function snapshotLinked(
  fenceId: FenceNode['id'],
  parentId: string | null,
  linkedPoint: FencePlanPoint,
): LinkedFenceSnapshot[] {
  const { nodes } = useScene.getState()
  const out: LinkedFenceSnapshot[] = []
  for (const node of Object.values(nodes)) {
    if (!node || node.type !== 'fence') continue
    if (node.id === fenceId) continue
    if ((node.parentId ?? null) !== parentId) continue
    if (!samePoint(node.start, linkedPoint) && !samePoint(node.end, linkedPoint)) continue
    out.push({
      id: node.id,
      start: [node.start[0], node.start[1]],
      end: [node.end[0], node.end[1]],
    })
  }
  return out
}

function linkedCascade(
  linked: LinkedFenceSnapshot[],
  origin: FencePlanPoint,
  next: FencePlanPoint,
): LinkedFenceSnapshot[] {
  return linked.map((l) => ({
    id: l.id,
    start: samePoint(l.start, origin) ? next : l.start,
    end: samePoint(l.end, origin) ? next : l.end,
  }))
}

export const moveFenceEndpointDragAction: DragAction<MoveFenceEndpointCtx, MoveFenceEndpointDraft> =
  {
    begin: (input) => {
      const fence = input.node as FenceNode | undefined
      if (!fence) throw new Error('[moveFenceEndpointDragAction] begin requires a fence node')
      const endpoint = (input.handleId ?? 'end') as 'start' | 'end'
      const parentId = fence.parentId ?? null
      const originalStart: FencePlanPoint = [fence.start[0], fence.start[1]]
      const originalEnd: FencePlanPoint = [fence.end[0], fence.end[1]]
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

      return {
        fenceId: fence.id as AnyNodeId,
        endpoint,
        originalStart,
        originalEnd,
        originalMovingPoint,
        fixedPoint,
        parentId,
        linkedOriginals: snapshotLinked(fence.id, parentId, originalMovingPoint),
        levelWalls,
        levelFences,
      }
    },

    preview: (ctx, point, modifiers) => {
      const planPoint: FencePlanPoint = [point[0], point[1]]
      const snapped = snapFenceDraftPoint({
        point: planPoint,
        walls: ctx.levelWalls,
        fences: ctx.levelFences,
        start: ctx.fixedPoint,
        angleSnap: !modifiers.shift,
        ignoreFenceIds: [ctx.fenceId as string],
      })
      const nextStart = ctx.endpoint === 'start' ? snapped : ctx.fixedPoint
      const nextEnd = ctx.endpoint === 'end' ? snapped : ctx.fixedPoint
      const detached = modifiers.alt
      const linkedUpdates = detached
        ? []
        : linkedCascade(ctx.linkedOriginals, ctx.originalMovingPoint, snapped)
      return {
        movingPoint: snapped,
        start: nextStart,
        end: nextEnd,
        linkedUpdates,
        detached,
      }
    },

    apply: (draft, ctx, scene) => {
      scene.update(ctx.fenceId, { start: draft.start, end: draft.end } as Partial<AnyNode>)
      const dirty: AnyNodeId[] = [ctx.fenceId]
      for (const linked of draft.linkedUpdates) {
        scene.update(
          linked.id as AnyNodeId,
          {
            start: linked.start,
            end: linked.end,
          } as Partial<AnyNode>,
        )
        dirty.push(linked.id as AnyNodeId)
      }
      return dirty
    },

    commit: (draft, ctx, scene) => {
      // Min-length rejection still matters — too-short fence is invalid
      // and should bounce back via the cancel path (snapshot restore).
      // But the "no-change" rejection is removed: see
      // fence/actions/curve.ts for the rationale (no-op drag must still
      // push a pastState entry to avoid Ctrl-Z cancelling the fence
      // creation that preceded the activation).
      if (!isWallLongEnough(draft.start, draft.end)) return false

      // Single-undo dance: revert to originals (paused history → no
      // zundo record), resume history, then re-apply the final draft
      // so zundo captures the entire drag as one undo step. terminate()
      // calls resumeHistory again — depth-counted, becomes a no-op.
      scene.restoreAll()
      scene.resumeHistory()
      scene.update(ctx.fenceId, { start: draft.start, end: draft.end } as Partial<AnyNode>)
      if (!draft.detached) {
        for (const linked of draft.linkedUpdates) {
          scene.update(
            linked.id as AnyNodeId,
            {
              start: linked.start,
              end: linked.end,
            } as Partial<AnyNode>,
          )
        }
      }
      return true
    },

    cancel: (_ctx, _scene) => {
      // No-op — createDragSession.cancel() calls scene.restoreAll()
      // which puts every touched node back via the snapshot.
    },
  }

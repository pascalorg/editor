import {
  type AlignmentAnchor,
  type AnyNode,
  type AnyNodeId,
  collectAlignmentAnchors,
  type DragAction,
  type FenceNode,
  resolveAlignment,
  resolveFenceSupportSlabPatch,
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
 *  - **commit**: requires `hasChanged` && `isSegmentLongEnough(next)`.
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

/** Figma-style alignment-snap threshold (meters), matching the wall / item
 *  tools. */
const ALIGNMENT_THRESHOLD_M = 0.08

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
  /** Alignment anchors (endpoints + midpoints) of every OTHER wall / fence on
   *  the level (building-local), feeding the resolver. */
  alignCandidates: AlignmentAnchor[]
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
    if (node?.type !== 'fence') continue
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

/**
 * Re-elect the slab lift host for the given fences from their CURRENT
 * store state (call after the endpoint writes). Only writes when the host
 * actually changes, so unaffected drags stay patch-free.
 */
function applyFenceSupportPatches(
  ids: readonly AnyNodeId[],
  scene: { update(id: AnyNodeId, data: Partial<AnyNode>): void },
) {
  const nodes = useScene.getState().nodes
  for (const id of ids) {
    const fence = nodes[id]
    if (fence?.type !== 'fence') continue
    const patch = resolveFenceSupportSlabPatch(fence as FenceNode, nodes)
    if (patch.supportSlabId !== (fence as FenceNode).supportSlabId) {
      scene.update(id, patch as Partial<AnyNode>)
    }
  }
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

      // Alignment targets — anchors of every other alignable object (walls,
      // fences, items, slabs, ceilings, columns).
      const alignCandidates = collectAlignmentAnchors(useScene.getState().nodes, fence.id)

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
        alignCandidates,
      }
    },

    preview: (ctx, point, modifiers) => {
      const planPoint: FencePlanPoint = [point[0], point[1]]
      // Endpoint move honours the active snapping mode (HUD chip): grid → lattice;
      // lines → magnetic corner/alignment; angles → lock to 15° rays from the
      // fixed corner; off → raw. No Shift bypass — Shift cycles the mode; Off is
      // the bypass.
      const snapped = snapFenceDraftPoint({
        point: planPoint,
        walls: ctx.levelWalls,
        fences: ctx.levelFences,
        ignoreFenceIds: [ctx.fenceId as string],
        start: ctx.fixedPoint,
        angleSnap: isAngleSnapActive(),
        magnetic: isMagneticSnapActive(),
      })

      // Figma-style alignment: nudge the dragged endpoint onto another wall /
      // fence endpoint or midpoint axis when within threshold, and publish a
      // guide. The resolver connects to the NEAREST real anchor, so the dot
      // always sits on an actual point. Alt is reserved for detach. The guide is
      // DISPLAYED in every mode except Off (isAlignmentGuideActive); the
      // magnetic pull onto it is applied only in 'lines' mode
      // (isMagneticSnapActive).
      let aligned = snapped
      if (isAlignmentGuideActive() && ctx.alignCandidates.length > 0) {
        const ar = resolveAlignment({
          moving: [{ nodeId: ctx.fenceId as string, kind: 'corner', x: snapped[0], z: snapped[1] }],
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

      const nextStart = ctx.endpoint === 'start' ? aligned : ctx.fixedPoint
      const nextEnd = ctx.endpoint === 'end' ? aligned : ctx.fixedPoint
      const detached = modifiers.alt
      const linkedUpdates = detached
        ? []
        : linkedCascade(ctx.linkedOriginals, ctx.originalMovingPoint, aligned)
      return {
        movingPoint: aligned,
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
      // Re-elect the lift host live: a fence dragged onto / off an elevated
      // deck rises or drops with the pointer instead of waiting for commit
      // (fences run no per-frame election — `supportSlabId` IS the lift).
      applyFenceSupportPatches(dirty, scene)
      return dirty
    },

    commit: (draft, ctx, scene) => {
      useAlignmentGuides.getState().clear()
      // Min-length rejection still matters — too-short fence is invalid
      // and should bounce back via the cancel path (snapshot restore).
      // But the "no-change" rejection is removed: see
      // fence/actions/curve.ts for the rationale (no-op drag must still
      // push a pastState entry to avoid Ctrl-Z cancelling the fence
      // creation that preceded the activation).
      if (!isSegmentLongEnough(draft.start, draft.end)) return false

      // Single-undo dance: revert to originals (paused history → no
      // zundo record), resume history, then re-apply the final draft
      // so zundo captures the entire drag as one undo step. terminate()
      // calls resumeHistory again — depth-counted, becomes a no-op.
      scene.restoreAll()
      scene.resumeHistory()
      scene.update(ctx.fenceId, { start: draft.start, end: draft.end } as Partial<AnyNode>)
      const patched: AnyNodeId[] = [ctx.fenceId]
      if (!draft.detached) {
        for (const linked of draft.linkedUpdates) {
          scene.update(
            linked.id as AnyNodeId,
            {
              start: linked.start,
              end: linked.end,
            } as Partial<AnyNode>,
          )
          patched.push(linked.id as AnyNodeId)
        }
      }
      // The restoreAll above reverted any live host patch — re-run the
      // election against the final endpoints so the committed fence stands
      // on (or leaves) its deck. Uncapped: an endpoint drag has no commit
      // pointer ray worth trusting, matching the wall move commits.
      applyFenceSupportPatches(patched, scene)
      return true
    },

    cancel: (_ctx, _scene) => {
      useAlignmentGuides.getState().clear()
      // No-op otherwise — createDragSession.cancel() calls scene.restoreAll()
      // which puts every touched node back via the snapshot.
    },
  }

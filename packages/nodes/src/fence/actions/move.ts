import {
  type AnyNode,
  type AnyNodeId,
  type DragAction,
  type FenceNode,
  type LevelNode,
  sceneRegistry,
  useLiveTransforms,
  useScene,
  type WallNode,
} from '@pascal-app/core'
import { type FencePlanPoint, snapFenceDraftPoint, triggerSFX } from '@pascal-app/editor'
import type * as THREE from 'three'

function sameSnap(a: FencePlanPoint | null, b: FencePlanPoint): boolean {
  return a !== null && a[0] === b[0] && a[1] === b[1]
}

/**
 * Phase 5 Stage D — whole-fence move drag affordance.
 *
 * Migrates `MoveFenceTool` (302 LoC legacy) to the `DragAction` primitive.
 *
 * Visual strategy — **live-drag exception** (see
 * `editor/wiki/architecture/tools.md`): instead of writing the new
 * start/end into the scene store on every pointer tick (which would
 * re-rebuild the fence geometry — many posts, many infill panels —
 * every frame), the action keeps the underlying node untouched during
 * the drag and visually offsets the mesh directly via
 * `sceneRegistry.nodes.get(id).position` plus a mirror entry in
 * `useLiveTransforms`. On commit, the final start/end are written to
 * the scene with the single-undo dance — one Ctrl-Z reverses the whole
 * drag, the geometry rebuilds once.
 *
 * Linked-fence cascade: any other fence in the same parent whose
 * start or end matched one of this fence's endpoints at activation
 * follows the move so corners stay connected. No alt-detach (legacy
 * doesn't expose it for the whole-fence drag).
 */

function samePoint(a: FencePlanPoint, b: FencePlanPoint): boolean {
  return a[0] === b[0] && a[1] === b[1]
}

type LinkedFenceSnapshot = {
  id: FenceNode['id']
  start: FencePlanPoint
  end: FencePlanPoint
}

function snapshotLinked(args: {
  fenceId: FenceNode['id']
  parentId: string | null
  originalStart: FencePlanPoint
  originalEnd: FencePlanPoint
}): LinkedFenceSnapshot[] {
  const { fenceId, parentId, originalStart, originalEnd } = args
  const { nodes } = useScene.getState()
  const out: LinkedFenceSnapshot[] = []
  for (const node of Object.values(nodes)) {
    if (!node || node.type !== 'fence') continue
    if (node.id === fenceId) continue
    if ((node.parentId ?? null) !== parentId) continue
    if (
      !(
        samePoint(node.start, originalStart) ||
        samePoint(node.start, originalEnd) ||
        samePoint(node.end, originalStart) ||
        samePoint(node.end, originalEnd)
      )
    )
      continue
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
  originalStart: FencePlanPoint,
  originalEnd: FencePlanPoint,
  nextStart: FencePlanPoint,
  nextEnd: FencePlanPoint,
): LinkedFenceSnapshot[] {
  return linked.map((l) => ({
    id: l.id,
    start: samePoint(l.start, originalStart)
      ? nextStart
      : samePoint(l.start, originalEnd)
        ? nextEnd
        : l.start,
    end: samePoint(l.end, originalStart)
      ? nextStart
      : samePoint(l.end, originalEnd)
        ? nextEnd
        : l.end,
  }))
}

function setMeshOffset(fenceId: AnyNodeId, deltaX: number, deltaZ: number): void {
  const mesh = sceneRegistry.nodes.get(fenceId) as THREE.Object3D | undefined
  if (mesh) mesh.position.set(deltaX, 0, deltaZ)
}

function setLiveTransform(
  fenceId: AnyNodeId,
  originalStart: FencePlanPoint,
  originalEnd: FencePlanPoint,
  deltaX: number,
  deltaZ: number,
): void {
  const cx = (originalStart[0] + originalEnd[0]) / 2
  const cz = (originalStart[1] + originalEnd[1]) / 2
  useLiveTransforms.getState().set(fenceId, {
    position: [cx + deltaX, 0, cz + deltaZ],
    rotation: 0,
  })
}

function clearLiveState(fenceId: AnyNodeId, linked: LinkedFenceSnapshot[]): void {
  setMeshOffset(fenceId, 0, 0)
  useLiveTransforms.getState().clear(fenceId)
  for (const l of linked) {
    setMeshOffset(l.id as AnyNodeId, 0, 0)
    useLiveTransforms.getState().clear(l.id)
  }
}

export type MoveFenceCtx = {
  fenceId: AnyNodeId
  originalStart: FencePlanPoint
  originalEnd: FencePlanPoint
  parentId: string | null
  linkedOriginals: LinkedFenceSnapshot[]
  levelWalls: WallNode[]
  levelFences: FenceNode[]
  // Mutable: latched on the first preview call to the snapped pointer
  // position. Subsequent previews compute delta = pointer - dragAnchor.
  dragAnchor: FencePlanPoint | null
  // Mutable: tracks the last snapped pointer so preview can emit a
  // grid-snap sfx when the snapped value changes. Matches the legacy
  // MoveFenceTool's per-tick sound.
  lastSnapped: FencePlanPoint | null
}

export type MoveFenceDraft = {
  start: FencePlanPoint
  end: FencePlanPoint
  deltaX: number
  deltaZ: number
  linkedUpdates: LinkedFenceSnapshot[]
}

export const moveFenceDragAction: DragAction<MoveFenceCtx, MoveFenceDraft> = {
  begin: (input) => {
    const fence = input.node as FenceNode | undefined
    if (!fence) throw new Error('[moveFenceDragAction] begin requires a fence node')
    const parentId = fence.parentId ?? null
    const originalStart: FencePlanPoint = [fence.start[0], fence.start[1]]
    const originalEnd: FencePlanPoint = [fence.end[0], fence.end[1]]

    const { nodes } = useScene.getState()
    const levelNode =
      parentId && nodes[parentId as AnyNodeId]?.type === 'level'
        ? (nodes[parentId as AnyNodeId] as LevelNode)
        : null
    const levelWalls: WallNode[] = []
    const levelFences: FenceNode[] = []
    if (levelNode) {
      for (const childId of levelNode.children ?? []) {
        const child = nodes[childId as AnyNodeId]
        if (!child) continue
        if (child.type === 'wall') levelWalls.push(child)
        else if (child.type === 'fence') levelFences.push(child)
      }
    }

    return {
      fenceId: fence.id as AnyNodeId,
      originalStart,
      originalEnd,
      parentId,
      linkedOriginals: snapshotLinked({ fenceId: fence.id, parentId, originalStart, originalEnd }),
      levelWalls,
      levelFences,
      dragAnchor: null,
      lastSnapped: null,
    }
  },

  preview: (ctx, point, _modifiers) => {
    const snapped = snapFenceDraftPoint({
      point: [point[0], point[1]],
      walls: ctx.levelWalls,
      fences: ctx.levelFences,
      ignoreFenceIds: [ctx.fenceId as string],
    })
    // Emit grid-snap sfx when the snapped position changes between
    // ticks — matches the legacy MoveFenceTool's user feedback.
    if (!sameSnap(ctx.lastSnapped, snapped)) {
      if (ctx.lastSnapped !== null) triggerSFX('sfx:grid-snap')
      ctx.lastSnapped = snapped
    }
    // Latch the anchor on the first preview tick — matches legacy
    // "drag is delta from first move" semantics so the fence doesn't
    // jump to wherever the activation click landed.
    if (!ctx.dragAnchor) ctx.dragAnchor = snapped
    const deltaX = snapped[0] - ctx.dragAnchor[0]
    const deltaZ = snapped[1] - ctx.dragAnchor[1]
    const nextStart: FencePlanPoint = [ctx.originalStart[0] + deltaX, ctx.originalStart[1] + deltaZ]
    const nextEnd: FencePlanPoint = [ctx.originalEnd[0] + deltaX, ctx.originalEnd[1] + deltaZ]
    return {
      start: nextStart,
      end: nextEnd,
      deltaX,
      deltaZ,
      linkedUpdates: linkedCascade(
        ctx.linkedOriginals,
        ctx.originalStart,
        ctx.originalEnd,
        nextStart,
        nextEnd,
      ),
    }
  },

  apply: (draft, ctx, _scene) => {
    // Live-drag exception — visual-only via mesh.position + useLiveTransforms.
    // No scene.update during the drag (would re-rebuild fence geometry every
    // tick). The scene store still has the original start/end; commit() writes
    // the final values.
    setMeshOffset(ctx.fenceId, draft.deltaX, draft.deltaZ)
    setLiveTransform(ctx.fenceId, ctx.originalStart, ctx.originalEnd, draft.deltaX, draft.deltaZ)
    for (const linked of ctx.linkedOriginals) {
      setMeshOffset(linked.id as AnyNodeId, draft.deltaX, draft.deltaZ)
      setLiveTransform(linked.id as AnyNodeId, linked.start, linked.end, draft.deltaX, draft.deltaZ)
    }
    // Return no dirty IDs — geometry rebuild deferred to commit.
    return []
  },

  commit: (draft, ctx, scene) => {
    // Always push a pastState entry — see fence/actions/curve.ts. The
    // no-movement case would otherwise let Ctrl-Z cancel the fence
    // creation that preceded the move.
    //
    // Single-undo dance: snapshot is empty (live-drag exception, no
    // scene.update during apply), so restoreAll is a no-op. Resume,
    // then write the final draft so zundo records original → final
    // as one diff.
    scene.restoreAll()
    scene.resumeHistory()
    scene.update(ctx.fenceId, {
      start: draft.start,
      end: draft.end,
    } as Partial<AnyNode>)
    for (const linked of draft.linkedUpdates) {
      scene.update(
        linked.id as AnyNodeId,
        {
          start: linked.start,
          end: linked.end,
        } as Partial<AnyNode>,
      )
    }

    // Clear live-drag visual state — the scene store now has the final
    // values, so the renderer will re-mount the mesh at its real position
    // and useLiveTransforms is no longer needed.
    clearLiveState(ctx.fenceId, ctx.linkedOriginals)
    return true
  },

  cancel: (ctx, _scene) => {
    // Clear live-drag visual state so the mesh snaps back to the
    // original (still-unchanged) scene position. No scene rollback
    // needed — we never wrote anything.
    clearLiveState(ctx.fenceId, ctx.linkedOriginals)
  },
}

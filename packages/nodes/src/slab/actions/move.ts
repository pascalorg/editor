import {
  type AnyNode,
  type AnyNodeId,
  type DragAction,
  type FenceNode,
  type LevelNode,
  type SlabNode,
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
 * Phase 5 Stage D — whole-slab move drag affordance.
 *
 * Uses the **live-drag exception** (same recipe as fence move): the
 * slab MESH is translated visually via `sceneRegistry.nodes.get(slabId)
 * .position` plus a mirror entry in `useLiveTransforms`. The scene
 * store's polygon stays untouched during the drag — no React re-render
 * per tick, no CSG-with-holes rebuild per frame.
 *
 * On commit the final polygon is written to the scene via the single-
 * undo dance, then the mesh-position offset is cleared. The renderer
 * picks up the new polygon, the mesh re-mounts at the new world coords,
 * and zundo records one diff.
 *
 * Hosted items don't follow the visual translation (same as legacy —
 * item.position is independent of slab.polygon). Acceptable: the slab
 * snaps back into place on commit so the visual mismatch is brief.
 */

function translatePolygon(
  polygon: Array<[number, number]>,
  deltaX: number,
  deltaZ: number,
): Array<[number, number]> {
  return polygon.map(([x, z]) => [x + deltaX, z + deltaZ] as [number, number])
}

function polygonCenter(polygon: Array<[number, number]>): [number, number] {
  if (polygon.length === 0) return [0, 0]
  let sx = 0
  let sz = 0
  for (const [x, z] of polygon) {
    sx += x
    sz += z
  }
  return [sx / polygon.length, sz / polygon.length]
}

function setMeshOffset(id: AnyNodeId, deltaX: number, deltaZ: number): void {
  const mesh = sceneRegistry.nodes.get(id) as THREE.Object3D | undefined
  if (mesh) mesh.position.set(deltaX, 0, deltaZ)
}

function setLiveTransform(
  id: AnyNodeId,
  originalCenter: [number, number],
  deltaX: number,
  deltaZ: number,
): void {
  useLiveTransforms.getState().set(id, {
    position: [originalCenter[0] + deltaX, 0, originalCenter[1] + deltaZ],
    rotation: 0,
  })
}

function clearLiveState(id: AnyNodeId): void {
  setMeshOffset(id, 0, 0)
  useLiveTransforms.getState().clear(id)
}

export type MoveSlabCtx = {
  slabId: AnyNodeId
  originalPolygon: Array<[number, number]>
  originalHoles: Array<Array<[number, number]>>
  originalCenter: [number, number]
  parentId: string | null
  levelWalls: WallNode[]
  levelFences: FenceNode[]
  dragAnchor: FencePlanPoint | null
  lastSnapped: FencePlanPoint | null
}

export type MoveSlabDraft = {
  polygon: Array<[number, number]>
  holes: Array<Array<[number, number]>>
  deltaX: number
  deltaZ: number
}

export const moveSlabDragAction: DragAction<MoveSlabCtx, MoveSlabDraft> = {
  begin: (input) => {
    const slab = input.node as SlabNode | undefined
    if (!slab) throw new Error('[moveSlabDragAction] begin requires a slab node')
    const parentId = slab.parentId ?? null
    const originalPolygon: Array<[number, number]> = slab.polygon.map(
      ([x, z]) => [x, z] as [number, number],
    )
    const originalHoles: Array<Array<[number, number]>> = (slab.holes ?? []).map((h) =>
      h.map(([x, z]) => [x, z] as [number, number]),
    )

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
      slabId: slab.id as AnyNodeId,
      originalPolygon,
      originalHoles,
      originalCenter: polygonCenter(originalPolygon),
      parentId,
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
    })
    if (!sameSnap(ctx.lastSnapped, snapped)) {
      if (ctx.lastSnapped !== null) triggerSFX('sfx:grid-snap')
      ctx.lastSnapped = snapped
    }
    if (!ctx.dragAnchor) ctx.dragAnchor = snapped
    const deltaX = snapped[0] - ctx.dragAnchor[0]
    const deltaZ = snapped[1] - ctx.dragAnchor[1]
    // Translation is computed lazily on commit — preview only needs the
    // deltas for the mesh-offset visual.
    return {
      polygon: ctx.originalPolygon,
      holes: ctx.originalHoles,
      deltaX,
      deltaZ,
    }
  },

  apply: (draft, ctx, _scene) => {
    // Live-drag exception: visual translate via Three.js mesh.position +
    // useLiveTransforms. No scene.update during the drag, no React
    // re-render of the slab geometry, no CSG-with-holes rebuild.
    setMeshOffset(ctx.slabId, draft.deltaX, draft.deltaZ)
    setLiveTransform(ctx.slabId, ctx.originalCenter, draft.deltaX, draft.deltaZ)
    return []
  },

  commit: (draft, ctx, scene) => {
    // Single-undo dance — snapshot is empty (no scene.update during
    // apply), restoreAll is a no-op. Resume history, write the final
    // polygon. Zundo records one diff: original → translated.
    scene.restoreAll()
    scene.resumeHistory()
    scene.update(ctx.slabId, {
      polygon: translatePolygon(ctx.originalPolygon, draft.deltaX, draft.deltaZ),
      holes: ctx.originalHoles.map((h) => translatePolygon(h, draft.deltaX, draft.deltaZ)),
    } as Partial<AnyNode>)
    clearLiveState(ctx.slabId)
    return true
  },

  cancel: (ctx, _scene) => {
    // Clear live-drag visual state — mesh snaps back to its (unchanged)
    // scene position.
    clearLiveState(ctx.slabId)
  },
}

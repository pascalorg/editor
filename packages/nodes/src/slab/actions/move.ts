import {
  type AnyNode,
  type AnyNodeId,
  type DragAction,
  type FenceNode,
  type LevelNode,
  type SlabNode,
  useScene,
  type WallNode,
} from '@pascal-app/core'
import { type FencePlanPoint, snapFenceDraftPoint } from '@pascal-app/editor'

/**
 * Phase 5 Stage D — whole-slab move drag affordance.
 *
 * Translates the slab's boundary polygon (and any holes) rigidly under
 * the pointer. Snaps to walls / fences / grid at the level. Latches
 * the drag anchor on the first preview tick so the slab doesn't jump
 * to wherever the activation click landed.
 *
 * Unlike fence move, the slab port does **not** use the live-drag
 * exception — polygon CSG geometry is expensive to rebuild per frame,
 * but the legacy tool already writes the polygon to the scene every
 * pointer tick and the user perceives that as smooth. Matching that
 * for now; optimization is a separate task once we measure.
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

export type MoveSlabCtx = {
  slabId: AnyNodeId
  originalPolygon: Array<[number, number]>
  originalHoles: Array<Array<[number, number]>>
  parentId: string | null
  levelWalls: WallNode[]
  levelFences: FenceNode[]
  dragAnchor: FencePlanPoint | null
}

export type MoveSlabDraft = {
  polygon: Array<[number, number]>
  holes: Array<Array<[number, number]>>
  deltaX: number
  deltaZ: number
  center: [number, number]
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
      parentId,
      levelWalls,
      levelFences,
      dragAnchor: null,
    }
  },

  preview: (ctx, point, _modifiers) => {
    const snapped = snapFenceDraftPoint({
      point: [point[0], point[1]],
      walls: ctx.levelWalls,
      fences: ctx.levelFences,
    })
    if (!ctx.dragAnchor) ctx.dragAnchor = snapped
    const deltaX = snapped[0] - ctx.dragAnchor[0]
    const deltaZ = snapped[1] - ctx.dragAnchor[1]
    const polygon = translatePolygon(ctx.originalPolygon, deltaX, deltaZ)
    const holes = ctx.originalHoles.map((h) => translatePolygon(h, deltaX, deltaZ))
    return {
      polygon,
      holes,
      deltaX,
      deltaZ,
      center: polygonCenter(polygon),
    }
  },

  apply: (draft, ctx, scene) => {
    scene.update(ctx.slabId, {
      polygon: draft.polygon,
      holes: draft.holes,
    } as Partial<AnyNode>)
    return [ctx.slabId]
  },

  commit: (draft, ctx, scene) => {
    if (draft.deltaX === 0 && draft.deltaZ === 0) return false

    // Single-undo dance — revert via snapshot, resume history, re-apply
    // the final polygon/holes. Zundo captures the whole drag as one
    // Ctrl-Z step.
    scene.restoreAll()
    scene.resumeHistory()
    scene.update(ctx.slabId, {
      polygon: draft.polygon,
      holes: draft.holes,
    } as Partial<AnyNode>)
    return true
  },

  cancel: (_ctx, _scene) => {
    // No-op — orchestrator's scene.restoreAll() puts the original
    // polygon/holes back via the snapshot.
  },
}

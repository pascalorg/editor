import type { AnyNode, AnyNodeId, CeilingNode, DragAction } from '@pascal-app/core'

/**
 * Phase 5 Stage D — whole-ceiling move drag affordance.
 *
 * Mirrors `slab/actions/move.ts` shape but ceiling snaps purely to a
 * 0.5m grid (no wall/fence corner snap — ceilings are typically
 * placed independent of the floor layout). Drag anchor is latched on
 * the first preview tick so the ceiling doesn't jump.
 *
 * Single-undo dance on commit, same recipe as slab/fence.
 */

const GRID_STEP = 0.5

function snap(value: number): number {
  return Math.round(value / GRID_STEP) * GRID_STEP
}

function translatePolygon(
  polygon: Array<[number, number]>,
  deltaX: number,
  deltaZ: number,
): Array<[number, number]> {
  return polygon.map(([x, z]) => [x + deltaX, z + deltaZ] as [number, number])
}

export type MoveCeilingCtx = {
  ceilingId: AnyNodeId
  originalPolygon: Array<[number, number]>
  originalHoles: Array<Array<[number, number]>>
  dragAnchor: [number, number] | null
}

export type MoveCeilingDraft = {
  polygon: Array<[number, number]>
  holes: Array<Array<[number, number]>>
  deltaX: number
  deltaZ: number
}

export const moveCeilingDragAction: DragAction<MoveCeilingCtx, MoveCeilingDraft> = {
  begin: (input) => {
    const ceiling = input.node as CeilingNode | undefined
    if (!ceiling) throw new Error('[moveCeilingDragAction] begin requires a ceiling node')
    return {
      ceilingId: ceiling.id as AnyNodeId,
      originalPolygon: ceiling.polygon.map(([x, z]) => [x, z] as [number, number]),
      originalHoles: (ceiling.holes ?? []).map((h) =>
        h.map(([x, z]) => [x, z] as [number, number]),
      ),
      dragAnchor: null,
    }
  },

  preview: (ctx, point, _modifiers) => {
    const sx = snap(point[0])
    const sz = snap(point[1])
    if (!ctx.dragAnchor) ctx.dragAnchor = [sx, sz]
    const deltaX = sx - ctx.dragAnchor[0]
    const deltaZ = sz - ctx.dragAnchor[1]
    return {
      polygon: translatePolygon(ctx.originalPolygon, deltaX, deltaZ),
      holes: ctx.originalHoles.map((h) => translatePolygon(h, deltaX, deltaZ)),
      deltaX,
      deltaZ,
    }
  },

  apply: (draft, ctx, scene) => {
    scene.update(ctx.ceilingId, {
      polygon: draft.polygon,
      holes: draft.holes,
    } as Partial<AnyNode>)
    return [ctx.ceilingId]
  },

  commit: (draft, ctx, scene) => {
    if (draft.deltaX === 0 && draft.deltaZ === 0) return false
    scene.restoreAll()
    scene.resumeHistory()
    scene.update(ctx.ceilingId, {
      polygon: draft.polygon,
      holes: draft.holes,
    } as Partial<AnyNode>)
    return true
  },

  cancel: (_ctx, _scene) => {
    // No-op — orchestrator's scene.restoreAll() restores via snapshot.
  },
}

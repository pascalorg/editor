import {
  type AnyNode,
  type AnyNodeId,
  type CeilingNode,
  type DragAction,
  sceneRegistry,
  useLiveTransforms,
} from '@pascal-app/core'
import { triggerSFX } from '@pascal-app/editor'
import type * as THREE from 'three'

/**
 * Phase 5 Stage D — whole-ceiling move drag affordance.
 *
 * Live-drag exception (same recipe as slab/fence move): translate the
 * ceiling MESH visually via `sceneRegistry.nodes.get(ceilingId)
 * .position` plus a mirror in `useLiveTransforms`. No scene.update
 * during the drag → no React re-render, no polygon CSG rebuild per
 * tick. Snaps to a 0.5m grid (no wall/fence corner snap).
 *
 * On commit the final polygon is written via the single-undo dance
 * and the mesh-offset is cleared.
 */

const GRID_STEP = 0.5

function snap(value: number): number {
  return Math.round(value / GRID_STEP) * GRID_STEP
}

function sameSnap(a: [number, number] | null, b: [number, number]): boolean {
  return a !== null && a[0] === b[0] && a[1] === b[1]
}

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
  height: number,
): void {
  useLiveTransforms.getState().set(id, {
    position: [originalCenter[0] + deltaX, height, originalCenter[1] + deltaZ],
    rotation: 0,
  })
}

function clearLiveState(id: AnyNodeId): void {
  setMeshOffset(id, 0, 0)
  useLiveTransforms.getState().clear(id)
}

export type MoveCeilingCtx = {
  ceilingId: AnyNodeId
  originalPolygon: Array<[number, number]>
  originalHoles: Array<Array<[number, number]>>
  originalCenter: [number, number]
  height: number
  dragAnchor: [number, number] | null
  lastSnapped: [number, number] | null
}

export type MoveCeilingDraft = {
  deltaX: number
  deltaZ: number
}

export const moveCeilingDragAction: DragAction<MoveCeilingCtx, MoveCeilingDraft> = {
  begin: (input) => {
    const ceiling = input.node as CeilingNode | undefined
    if (!ceiling) throw new Error('[moveCeilingDragAction] begin requires a ceiling node')
    const originalPolygon = ceiling.polygon.map(([x, z]) => [x, z] as [number, number])
    return {
      ceilingId: ceiling.id as AnyNodeId,
      originalPolygon,
      originalHoles: (ceiling.holes ?? []).map((h) =>
        h.map(([x, z]) => [x, z] as [number, number]),
      ),
      originalCenter: polygonCenter(originalPolygon),
      height: ceiling.height ?? 2.5,
      dragAnchor: null,
      lastSnapped: null,
    }
  },

  preview: (ctx, point, _modifiers) => {
    const sx = snap(point[0])
    const sz = snap(point[1])
    const snapped: [number, number] = [sx, sz]
    if (!sameSnap(ctx.lastSnapped, snapped)) {
      if (ctx.lastSnapped !== null) triggerSFX('sfx:grid-snap')
      ctx.lastSnapped = snapped
    }
    if (!ctx.dragAnchor) ctx.dragAnchor = snapped
    return {
      deltaX: sx - ctx.dragAnchor[0],
      deltaZ: sz - ctx.dragAnchor[1],
    }
  },

  apply: (draft, ctx, _scene) => {
    setMeshOffset(ctx.ceilingId, draft.deltaX, draft.deltaZ)
    setLiveTransform(ctx.ceilingId, ctx.originalCenter, draft.deltaX, draft.deltaZ, ctx.height)
    return []
  },

  commit: (draft, ctx, scene) => {
    scene.restoreAll()
    scene.resumeHistory()
    scene.update(ctx.ceilingId, {
      polygon: translatePolygon(ctx.originalPolygon, draft.deltaX, draft.deltaZ),
      holes: ctx.originalHoles.map((h) => translatePolygon(h, draft.deltaX, draft.deltaZ)),
    } as Partial<AnyNode>)
    clearLiveState(ctx.ceilingId)
    return true
  },

  cancel: (ctx, _scene) => {
    clearLiveState(ctx.ceilingId)
  },
}

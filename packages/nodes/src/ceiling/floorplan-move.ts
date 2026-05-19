import {
  type AnyNodeId,
  type CeilingNode,
  type FloorplanMoveTarget,
  type FloorplanMoveTargetSession,
  sceneRegistry,
  useLiveTransforms,
  useScene,
} from '@pascal-app/core'
import { snapPointToGrid, type WallPlanPoint } from '@pascal-app/editor'
import type * as THREE from 'three'

/**
 * 2D floor-plan move handler for ceiling — mirrors the 3D `MoveCeilingTool`
 * live-drag pattern. See the equivalent module in `slab/floorplan-move.ts`
 * for the full rationale; the only ceiling-specific detail is the
 * preserved Y offset (`CeilingSystem` positions the mesh at `height − 0.01`
 * on rebuild, so the direct `mesh.position.y` mirrors that to avoid a
 * vertical teleport when the React group position is reconciled).
 */
const GRID_STEP = 0.5

function translatePolygon(
  polygon: ReadonlyArray<readonly [number, number]>,
  dx: number,
  dz: number,
): Array<[number, number]> {
  return polygon.map(([x, z]) => [x + dx, z + dz] as [number, number])
}

export const ceilingFloorplanMoveTarget: FloorplanMoveTarget<CeilingNode> = ({ node }) => {
  const ceilingId = node.id as AnyNodeId
  const originalPolygon = node.polygon.map(([x, z]) => [x, z] as [number, number])
  const originalHoles = (node.holes ?? []).map((hole) =>
    hole.map(([x, z]) => [x, z] as [number, number]),
  )
  const height = node.height ?? 2.5
  let anchor: [number, number] | null = null
  let lastDelta: [number, number] = [0, 0]

  const session: FloorplanMoveTargetSession = {
    affectedIds: [ceilingId],
    apply({ planPoint, modifiers }) {
      const snapped: WallPlanPoint = modifiers.shiftKey
        ? ([planPoint[0], planPoint[1]] as WallPlanPoint)
        : snapPointToGrid([planPoint[0], planPoint[1]] as WallPlanPoint, GRID_STEP)
      if (!anchor) {
        anchor = [snapped[0], snapped[1]]
        return
      }
      const dx = snapped[0] - anchor[0]
      const dz = snapped[1] - anchor[1]
      lastDelta = [dx, dz]
      useLiveTransforms.getState().set(ceilingId, {
        position: [dx, 0, dz],
        rotation: 0,
      })
      const mesh = sceneRegistry.nodes.get(ceilingId) as THREE.Object3D | undefined
      // Preserve ceiling height — `CeilingSystem` sets `mesh.position.y =
      // height − 0.01` on each rebuild; mirror that during the drag so
      // the mesh stays at ceiling height (not collapsed to y=0).
      if (mesh) mesh.position.set(dx, height - 0.01, dz)
    },
    canCommit() {
      const live = useScene.getState().nodes[ceilingId] as CeilingNode | undefined
      if (!live || live.type !== 'ceiling') return false
      const [dx, dz] = lastDelta
      if (dx === 0 && dz === 0) return false
      // Sync commit sequence — see `slab/floorplan-move.ts` for the
      // full ordering rationale (scene write → direct markDirty →
      // useLiveTransforms.clear, all sync in this handler so React
      // render + CeilingSystem rebuild land in the same paint).
      useScene.getState().updateNodes([
        {
          id: ceilingId,
          data: {
            polygon: translatePolygon(originalPolygon, dx, dz),
            holes: originalHoles.map((h) => translatePolygon(h, dx, dz)),
          },
        },
      ])
      useScene.getState().markDirty(ceilingId)
      useLiveTransforms.getState().clear(ceilingId)
      return true
    },
  }
  return session
}

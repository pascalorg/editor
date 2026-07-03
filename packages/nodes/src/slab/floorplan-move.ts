import {
  type AnyNodeId,
  type FloorplanMoveTarget,
  type FloorplanMoveTargetSession,
  snapPointToGrid,
  type SlabNode,
  sceneRegistry,
  useLiveTransforms,
  useScene,
  type WallPlanPoint,
} from '@pascal-app/core'
import type * as THREE from 'three'

/**
 * 2D floor-plan move handler for slab — mirrors the 3D `MoveSlabTool`
 * live-drag pattern so the visual stays smooth in split view.
 *
 * **Why not write the polygon every tick?** Per-tick `scene.update` on
 * `polygon` triggers a CSG geometry rebuild in `GeometrySystem` every
 * frame. Even with a synchronous `markDirty`, the rebuild dispose/add
 * pair flickers in the 3D viewer and the slab visibly catches up to
 * the cursor one frame late — the same regression `commit f4ea07e` was
 * fixed for in the 3D mover. The fix there: don't touch `scene` during
 * the drag at all. Translate the rendered `<group>` via the live-drag
 * exception (`mesh.position` + `useLiveTransforms.position = delta`).
 * On commit, write the polygon once.
 *
 * **Delta semantics** (see `wiki/architecture/tools.md` — "useLiveTransforms
 * contract is per-kind, not generic"): polygon-based kinds carry their
 * "position" in the polygon vertices, not a node.position field. The
 * `useLiveTransforms.position` must be a translation **delta**
 * (`[Δx, 0, Δz]`), which `ParametricNodeRenderer` consumes as the group
 * position. Visual = group.position + group.children-in-original-coords
 * = (delta) + (original polygon vertices) = translated, with no
 * geometry rebuild.
 *
 * **Commit path**: `canCommit` is the only side-effectful write to
 * `scene`. The dispatcher captured snapshots before the first apply,
 * so its snapshot-diff after `canCommit` returns will see one update
 * (the translated polygon) and run the single-undo dance against it.
 * `MoveSlabTool`'s cleanup (fires when `setMovingNode(null)` runs after
 * the commit) handles the `useLiveTransforms.clear` + the React-render
 * that resets `group.position` to (0,0,0) — by then `GeometrySystem`
 * has rebuilt with the new polygon, so the visual lands at the same
 * world position with no teleport.
 */
const GRID_STEP = 0.5

function translatePolygon(
  polygon: ReadonlyArray<readonly [number, number]>,
  dx: number,
  dz: number,
): Array<[number, number]> {
  return polygon.map(([x, z]) => [x + dx, z + dz] as [number, number])
}

export const slabFloorplanMoveTarget: FloorplanMoveTarget<SlabNode> = ({ node }) => {
  const slabId = node.id as AnyNodeId
  const originalPolygon = node.polygon.map(([x, z]) => [x, z] as [number, number])
  const originalHoles = (node.holes ?? []).map((hole) =>
    hole.map(([x, z]) => [x, z] as [number, number]),
  )
  let anchor: [number, number] | null = null
  let lastDelta: [number, number] = [0, 0]

  const session: FloorplanMoveTargetSession = {
    affectedIds: [slabId],
    apply({ planPoint, modifiers }) {
      const snapped: WallPlanPoint = modifiers.shiftKey
        ? ([planPoint[0], planPoint[1]] as WallPlanPoint)
        : ([...snapPointToGrid([planPoint[0], planPoint[1]] as WallPlanPoint, GRID_STEP)] as WallPlanPoint)
      if (!anchor) {
        anchor = [snapped[0], snapped[1]]
        return
      }
      const dx = snapped[0] - anchor[0]
      const dz = snapped[1] - anchor[1]
      lastDelta = [dx, dz]
      // Live-drag exception (wiki/architecture/tools.md): write the
      // delta to BOTH `mesh.position` (direct Three.js mutation) and
      // `useLiveTransforms.position` (React-bound source of truth).
      // They MUST match — `ParametricNodeRenderer` re-renders on every
      // useLiveTransforms change and reconciles `<group position={...}>`,
      // so a divergence makes the two writes fight every frame.
      useLiveTransforms.getState().set(slabId, {
        position: [dx, 0, dz],
        rotation: 0,
      })
      const mesh = sceneRegistry.nodes.get(slabId) as THREE.Object3D | undefined
      if (mesh) mesh.position.set(dx, 0, dz)
    },
    canCommit() {
      const live = useScene.getState().nodes[slabId] as SlabNode | undefined
      if (!live || live.type !== 'slab') return false
      const [dx, dz] = lastDelta
      if (dx === 0 && dz === 0) return false
      // Side-effect commit sequence — mirrors `MoveSlabTool.onGridClick`
      // so the React render that clears `group.position` (via the
      // useLiveTransforms.clear below) and the `GeometrySystem` rebuild
      // (via the sync `markDirty`) land in the same paint cycle. Order
      // matters:
      //   1. Write the translated polygon to `scene`. The dispatcher's
      //      snapshot-diff right after `canCommit` returns will pick
      //      this up as the single tracked change for undo.
      //   2. `markDirty` directly — bypasses the rAF-deferred batch in
      //      `updateNodesAction`, so `GeometrySystem` sees the dirty
      //      flag synchronously and can rebuild this frame (without
      //      this the rebuild slides into the next frame and the slab
      //      visually pops to its original position for one paint).
      //   3. Clear `useLiveTransforms` — `ParametricNodeRenderer` then
      //      re-renders `<group position={[0,0,0]}>` instead of the
      //      live delta. Without the rebuild from step 2 also landing
      //      this frame, the group would render at (0,0,0) over the
      //      *unrebuilt* (still-original) geometry → original-position
      //      blink. With step 2 in place, the rebuild and the React
      //      render commit together → smooth.
      useScene.getState().updateNodes([
        {
          id: slabId,
          data: {
            polygon: translatePolygon(originalPolygon, dx, dz),
            holes: originalHoles.map((h) => translatePolygon(h, dx, dz)),
          },
        },
      ])
      useScene.getState().markDirty(slabId)
      useLiveTransforms.getState().clear(slabId)
      return true
    },
  }
  return session
}

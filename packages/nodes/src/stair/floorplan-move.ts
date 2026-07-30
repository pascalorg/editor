import {
  type AnyNodeId,
  collectAlignmentAnchors,
  type FloorplanMoveTarget,
  type FloorplanMoveTargetSession,
  movingAlignmentAnchors,
  type StairNode,
  snapScalar,
  useLiveNodeOverrides,
  useScene,
} from '@pascal-app/core'
import {
  applyFloorplanAlignment,
  getSegmentGridStep,
  isGridSnapActive,
  isMagneticSnapActive,
} from '@pascal-app/editor'
import { createFloorplanCursorResolver } from '../shared/floorplan-cursor'

/**
 * 2D floor-plan move handler for stair.
 *
 * Existing stairs preserve the cursor grab offset, matching the 3D move
 * tools; fresh catalog placement follows the cursor absolutely.
 *
 * Figma alignment is layered on the stair footprint edges.
 * Guides are cleared by `FloorplanRegistryMoveOverlay`'s Path 1 teardown.
 *
 * The position previews through the live override store and is written to
 * scene once via `commit()`.
 */
export const stairFloorplanMoveTarget: FloorplanMoveTarget<StairNode> = ({ node, nodes }) => {
  const startY = node.position[1]
  const resolveCursor = createFloorplanCursorResolver({
    original: [node.position[0], node.position[2]],
    metadata: node.metadata,
  })
  // Alignment candidates gathered once — the scene is stable during the drag.
  const candidates = collectAlignmentAnchors(nodes, node.id)
  let lastValid: { position: [number, number, number] } | null = null

  const session: FloorplanMoveTargetSession = {
    affectedIds: [node.id as AnyNodeId],
    apply({ planPoint }) {
      const step = isGridSnapActive() ? getSegmentGridStep() : 0
      const snap = (value: number) => (step > 0 ? snapScalar(value, step) : value)
      const [gx, gz] = resolveCursor(planPoint, { snap })
      // Figma alignment on the actual stair footprint, matching the 3D move
      // tool. Publishes guides via `useAlignmentGuides`.
      const movingAnchors = movingAlignmentAnchors(node, nodes, gx, gz, node.rotation ?? 0)
      const { point: aligned } = applyFloorplanAlignment(
        [gx, gz],
        movingAnchors.length > 0
          ? movingAnchors
          : [{ nodeId: node.id, kind: 'corner', x: gx, z: gz }],
        candidates,
        { applySnap: isMagneticSnapActive() },
      )
      const sx = aligned[0]
      const sz = aligned[1]

      if (lastValid && lastValid.position[0] === sx && lastValid.position[2] === sz) return
      lastValid = { position: [sx, startY, sz] }
      useLiveNodeOverrides.getState().set(node.id as AnyNodeId, lastValid)
      useScene.getState().markDirty(node.id as AnyNodeId)
    },
    canCommit() {
      // No overlap / placement rules for stairs in 2D — any pointer-up
      // position commits, as long as we actually moved. Mirrors the 3D
      // move tool which also lets stairs land anywhere on the slab.
      return lastValid !== null
    },
    commit() {
      // Own the atomic write so the overlay takes the deterministic
      // commit-path (revert → resume → session.commit()). Same pattern
      // door / window use.
      if (!lastValid) return
      useLiveNodeOverrides.getState().clear(node.id as AnyNodeId)
      useScene.getState().updateNodes([{ id: node.id as AnyNodeId, data: lastValid }])
    },
  }

  return session
}

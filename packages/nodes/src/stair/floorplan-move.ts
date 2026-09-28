import {
  type AnyNodeId,
  collectAlignmentAnchors,
  type FloorplanMoveTarget,
  type FloorplanMoveTargetSession,
  getFloorStackedPosition,
  movingAlignmentAnchors,
  type StairNode,
  type StairSegmentNode,
  snapScalar,
  useLiveNodeOverrides,
  useScene,
} from '@pascal-app/core'
import {
  applyFloorplanAlignment,
  getSegmentGridStep,
  isGridSnapActive,
  isMagneticSnapActive,
  type LandscapeStairSnap,
  resolveLandscapeStairSnap,
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
  let lastValid: { position: [number, number, number]; rotation?: number } | null = null
  const flight = node.children
    .map((id) => nodes[id])
    .find(
      (child): child is StairSegmentNode =>
        child?.type === 'stair-segment' && child.segmentType === 'stair',
    )
  let landscapeSnap: LandscapeStairSnap | null = null

  const session: FloorplanMoveTargetSession = {
    affectedIds: flight ? [node.id as AnyNodeId, flight.id as AnyNodeId] : [node.id as AnyNodeId],
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

      const sceneNodes = useScene.getState().nodes
      const baseElevation = getFloorStackedPosition({
        node,
        nodes: sceneNodes,
        position: [sx, startY, sz],
        rotation: node.rotation,
        levelId: node.parentId,
      })[1]
      landscapeSnap = resolveLandscapeStairSnap(
        node,
        sceneNodes,
        [sx, startY, sz],
        flight?.length ?? 3,
        baseElevation,
      )
      const position = landscapeSnap?.position ?? ([sx, startY, sz] as [number, number, number])
      if (
        lastValid &&
        lastValid.position[0] === position[0] &&
        lastValid.position[2] === position[2] &&
        lastValid.rotation === landscapeSnap?.rotation
      )
        return
      lastValid = { position, ...(landscapeSnap ? { rotation: landscapeSnap.rotation } : {}) }
      if (!landscapeSnap) useLiveNodeOverrides.getState().clear(node.id as AnyNodeId)
      useLiveNodeOverrides.getState().set(node.id as AnyNodeId, {
        ...lastValid,
        ...(landscapeSnap
          ? {
              totalRise: landscapeSnap.totalRise,
              stepCount: landscapeSnap.stepCount,
              landscapeSurfaceId: landscapeSnap.surfaceId,
              railingMode: 'none' as const,
            }
          : { landscapeSurfaceId: undefined }),
      })
      if (flight) {
        if (landscapeSnap)
          useLiveNodeOverrides.getState().set(flight.id as AnyNodeId, {
            height: landscapeSnap.totalRise,
            length: landscapeSnap.length,
            stepCount: landscapeSnap.stepCount,
          })
        else useLiveNodeOverrides.getState().clear(flight.id as AnyNodeId)
      }
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
      if (flight) useLiveNodeOverrides.getState().clear(flight.id as AnyNodeId)
      const sceneNodes = useScene.getState().nodes
      useScene.getState().updateNodes([
        {
          id: node.id as AnyNodeId,
          data: {
            ...lastValid,
            ...(landscapeSnap
              ? {
                  totalRise: landscapeSnap.totalRise,
                  stepCount: landscapeSnap.stepCount,
                  slabOpeningMode: 'none' as const,
                  landscapeSurfaceId: landscapeSnap.surfaceId,
                  railingMode: 'none' as const,
                }
              : node.landscapeSurfaceId
                ? { landscapeSurfaceId: undefined }
                : {}),
          },
        },
        ...(landscapeSnap && flight
          ? [
              {
                id: flight.id as AnyNodeId,
                data: {
                  height: landscapeSnap.totalRise,
                  length: landscapeSnap.length,
                  stepCount: landscapeSnap.stepCount,
                },
              },
            ]
          : []),
      ])
    },
  }

  return session
}

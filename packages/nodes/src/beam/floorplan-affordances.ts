import {
  type AnyNode,
  type AnyNodeId,
  type BeamNode,
  type FloorplanAffordance,
  type FloorplanAffordanceSession,
  useLiveNodeOverrides,
  useScene,
  type WallNode,
} from '@pascal-app/core'
import {
  alignFloorplanDraftPoint,
  type FencePlanPoint,
  getSegmentGridStep,
  isAlignmentGuideActive,
  isAngleSnapActive,
  isMagneticSnapActive,
  isSegmentLongEnough,
  snapBuildingLocalToWorldGrid,
  snapFenceDraftPoint,
  useAlignmentGuides,
} from '@pascal-app/editor'

/**
 * Floor-plan 2D endpoint drag for beam — sister to the 3D
 * `move-endpoint-tool.tsx` + `actions/move-endpoint.ts`. Same interaction
 * (endpoint snap pipeline + Figma-style alignment), driven from SVG
 * pointer events instead of R3F grid events.
 *
 *   1. Capture the original start/end + the fixed (non-dragged) point.
 *   2. Per tick: snap the moving point (grid → angle lock off the fixed
 *      corner → magnetic to walls/fences), align to other nodes'
 *      endpoints/midpoints, publish overrides.
 *   3. On pointer-up: `commit()` writes the final endpoints in one
 *      tracked update and clears the overrides. `canCommit` guards
 *      against a collapsed span.
 *
 * No linked-beam cascade — beams share no endpoint relation — so there is
 * no ALT-detach path to wire.
 */
type BeamEndpointPayload = { beamId: AnyNodeId; endpoint: 'start' | 'end' }

function collectLevelWalls(nodes: Record<AnyNodeId, AnyNode>, excludeId?: AnyNodeId): WallNode[] {
  const out: WallNode[] = []
  for (const node of Object.values(nodes)) {
    if (node?.type === 'wall' && node.id !== excludeId) out.push(node as WallNode)
  }
  return out
}

export const beamMoveEndpointAffordance: FloorplanAffordance<BeamNode> = {
  start({ node, payload }): FloorplanAffordanceSession {
    const { endpoint } = payload as BeamEndpointPayload
    const fixedPoint: FencePlanPoint =
      endpoint === 'start' ? ([...node.end] as FencePlanPoint) : ([...node.start] as FencePlanPoint)
    const originalStart: FencePlanPoint = [...node.start] as FencePlanPoint
    const originalEnd: FencePlanPoint = [...node.end] as FencePlanPoint
    let lastStart: FencePlanPoint = originalStart
    let lastEnd: FencePlanPoint = originalEnd

    return {
      affectedIds: [node.id],
      apply({ planPoint }) {
        // Re-collect walls each tick so the snap pipeline sees fresh
        // positions (matters when the user releases + re-grabs without
        // unmounting the layer).
        const sceneNodes = useScene.getState().nodes
        const walls = collectLevelWalls(sceneNodes, node.id)
        const angleLocked = isAngleSnapActive()
        const snapped = snapFenceDraftPoint({
          point: planPoint as FencePlanPoint,
          walls,
          fences: [],
          ignoreFenceIds: [node.id as string],
          start: angleLocked ? fixedPoint : undefined,
          angleSnap: angleLocked,
          magnetic: isMagneticSnapActive(),
          gridSnap: (p) => snapBuildingLocalToWorldGrid(p, getSegmentGridStep()),
        })
        // Figma-style alignment on the dragged corner — same as the wall
        // endpoint affordance: guide displayed in every mode except Off,
        // magnetic pull applied only in 'lines' mode.
        const aligned = alignFloorplanDraftPoint(snapped, {
          applySnap: isMagneticSnapActive(),
          bypass: !isAlignmentGuideActive(),
          excludeIds: [node.id],
        }) as FencePlanPoint

        lastStart = endpoint === 'start' ? aligned : fixedPoint
        lastEnd = endpoint === 'end' ? aligned : fixedPoint

        useLiveNodeOverrides
          .getState()
          .set(node.id as AnyNodeId, { start: lastStart, end: lastEnd })
        useScene.getState().markDirty(node.id as AnyNodeId)
      },
      canCommit() {
        // Pointer-up always runs canCommit — drop the alignment guide here
        // so it doesn't linger after a commit / reject.
        useAlignmentGuides.getState().clear()
        return isSegmentLongEnough(lastStart, lastEnd)
      },
      commit() {
        useScene.getState().updateNodes([{ id: node.id, data: { start: lastStart, end: lastEnd } }])
        useLiveNodeOverrides.getState().clear(node.id as AnyNodeId)
      },
    }
  },
}

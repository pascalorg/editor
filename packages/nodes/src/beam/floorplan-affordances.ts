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
import { cascadeLinkedBeamUpdates, collectLinkedBeams, linkedBeamsAtMovingCorner } from './cascade'

/**
 * Floor-plan 2D endpoint drag for beam — sister to the 3D
 * `move-endpoint-tool.tsx` + `actions/move-endpoint.ts`. Same interaction
 * (endpoint snap pipeline + Figma-style alignment + linked-beam corner
 * cascade), driven from SVG pointer events instead of R3F grid events.
 *
 *   1. Capture the original start/end + the fixed (non-dragged) point and
 *      the sibling beams sharing either endpoint ("linked beams").
 *   2. Per tick: snap the moving point (grid → angle lock off the fixed
 *      corner → magnetic to walls/fences), align to other nodes'
 *      endpoints/midpoints, cascade the dragged corner onto the linked
 *      beams, publish overrides.
 *   3. On pointer-up: `commit()` writes the final endpoints in one
 *      tracked update and clears the overrides. `canCommit` guards
 *      against a collapsed span.
 *
 * Alt detaches: linked beams keep their original endpoints and only the
 * dragged beam moves.
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
  start({ node, payload, nodes }): FloorplanAffordanceSession {
    const { endpoint } = payload as BeamEndpointPayload
    const fixedPoint: FencePlanPoint =
      endpoint === 'start' ? ([...node.end] as FencePlanPoint) : ([...node.start] as FencePlanPoint)
    const originalStart: FencePlanPoint = [...node.start] as FencePlanPoint
    const originalEnd: FencePlanPoint = [...node.end] as FencePlanPoint
    const originalMovingPoint = endpoint === 'start' ? originalStart : originalEnd
    const levelBeams: BeamNode[] = Object.values(nodes).filter(
      (n): n is BeamNode => n?.type === 'beam',
    )
    const linkedBeams = collectLinkedBeams(
      levelBeams,
      node.id as AnyNodeId,
      node.parentId ?? null,
      originalStart,
      originalEnd,
    )
    // Beams sharing the MOVING corner cascade with the drag — their stale
    // anchors are excluded from the alignment pool while attached; under
    // Alt-detach they stay put and rejoin it. Only those beams are written,
    // so only they (plus the dragged beam) are snapshot as affected.
    const movingLinkedIds = linkedBeamsAtMovingCorner(linkedBeams, originalMovingPoint)
    const affectedIds: AnyNodeId[] = [node.id as AnyNodeId, ...movingLinkedIds]
    let lastStart: FencePlanPoint = originalStart
    let lastEnd: FencePlanPoint = originalEnd
    let lastLinkedUpdates: Array<{ id: AnyNodeId; start: FencePlanPoint; end: FencePlanPoint }> = []
    let lastAltDetach = false

    return {
      affectedIds,
      apply({ planPoint, modifiers }) {
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
        // magnetic pull applied only in 'lines' mode. The dragged beam and
        // the linked beams moving with it are excluded from the candidates;
        // Alt-detach leaves them put so they stay valid anchors.
        const aligned = alignFloorplanDraftPoint(snapped, {
          applySnap: isMagneticSnapActive(),
          bypass: !isAlignmentGuideActive(),
          excludeIds: modifiers.altKey
            ? [node.id as string]
            : [node.id as string, ...movingLinkedIds.map(String)],
        }) as FencePlanPoint

        lastStart = endpoint === 'start' ? aligned : fixedPoint
        lastEnd = endpoint === 'end' ? aligned : fixedPoint
        lastAltDetach = modifiers.altKey

        // ALT detaches: the linked beams keep their original endpoints and
        // only the dragged beam moves.
        const linkedUpdates = modifiers.altKey
          ? []
          : cascadeLinkedBeamUpdates(
              linkedBeams,
              originalStart,
              originalEnd,
              endpoint,
              lastStart,
              lastEnd,
            )
        lastLinkedUpdates = linkedUpdates

        const overrides = useLiveNodeOverrides.getState()
        const sceneState = useScene.getState()
        overrides.set(node.id as AnyNodeId, { start: lastStart, end: lastEnd })
        sceneState.markDirty(node.id as AnyNodeId)
        if (modifiers.altKey) {
          // Attach→detach transition: linked beams dragged on earlier
          // attached ticks still carry overrides — drop them so their
          // corners snap back to the scene originals (untouched during the
          // drag).
          for (const linked of linkedBeams) {
            if (overrides.get(linked.id)) {
              overrides.clear(linked.id)
              sceneState.markDirty(linked.id)
            }
          }
        }
        for (const upd of linkedUpdates) {
          overrides.set(upd.id, { start: upd.start, end: upd.end })
          sceneState.markDirty(upd.id)
        }
      },
      canCommit() {
        // Pointer-up always runs canCommit — drop the alignment guide here
        // so it doesn't linger after a commit / reject.
        useAlignmentGuides.getState().clear()
        return isSegmentLongEnough(lastStart, lastEnd)
      },
      commit() {
        // Atomic tracked write of the final endpoints — dragged beam plus
        // the cascaded linked beams — then drop the overrides so the scene
        // state is the single source of truth again.
        useScene.getState().updateNodes([
          { id: node.id, data: { start: lastStart, end: lastEnd } },
          ...(lastAltDetach
            ? []
            : lastLinkedUpdates.map((upd) => ({
                id: upd.id,
                data: { start: upd.start, end: upd.end },
              }))),
        ])
        const overrides = useLiveNodeOverrides.getState()
        overrides.clear(node.id as AnyNodeId)
        for (const upd of lastLinkedUpdates) overrides.clear(upd.id)
      },
    }
  },
}

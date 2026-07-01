import {
  type AnyNode,
  type AnyNodeId,
  type FloorplanAffordance,
  type FloorplanAffordanceSession,
  getMaxWallCurveOffset,
  getWallChordFrame,
  normalizeWallCurveOffset,
  useLiveNodeOverrides,
  useScene,
  type WallNode,
} from '@pascal-app/core'
import {
  alignFloorplanDraftPoint,
  getSegmentGridStep,
  isAlignmentGuideActive,
  isAngleSnapActive,
  isMagneticSnapActive,
  isSegmentLongEnough,
  snapBuildingLocalToWorldGrid,
  snapScalarToGrid,
  snapWallDraftPoint,
  useAlignmentGuides,
  type WallPlanPoint,
} from '@pascal-app/editor'

/**
 * Floor-plan 2D drag affordances for wall.
 *
 * Sister file to `move-endpoint-tool.tsx` — the 3D component port. This
 * one drives the same legacy interaction from SVG pointer events instead
 * of R3F grid events. The mutation logic is identical:
 *
 *   1. Capture original positions of the dragged wall + every wall whose
 *      endpoint coincides with either of the dragged wall's endpoints
 *      ("linked walls").
 *   2. On each tick: snap the moving point (grid → linked-wall → angle),
 *      compute primary endpoints, and cascade matching corners onto the
 *      linked walls. Publish to `useLiveNodeOverrides` — `WallSystem`,
 *      the 2D floor-plan layer, and the sidebar panel all merge the
 *      overrides in when reading endpoints, so `useScene` never sees a
 *      mid-drag write.
 *   3. On pointer-up: the dispatcher invokes `commit()`, which writes
 *      the final state to scene in one tracked update and clears the
 *      overrides. `canCommit` still guards against collapsed walls.
 *
 * Alt-detach (drop linked walls) is wired via the standard modifier
 * flags on the session.
 */

type WallEndpointPayload = { wallId: AnyNodeId; endpoint: 'start' | 'end' }

function pointsEqual(a: readonly number[], b: readonly number[]) {
  return a[0] === b[0] && a[1] === b[1]
}

function collectLevelWalls(
  nodes: Record<AnyNodeId, AnyNode>,
  excludeWallId?: AnyNodeId,
): WallNode[] {
  const out: WallNode[] = []
  for (const node of Object.values(nodes)) {
    if (node?.type === 'wall' && node.id !== excludeWallId) out.push(node as WallNode)
  }
  return out
}

function collectLinkedWalls(
  nodes: Record<AnyNodeId, AnyNode>,
  draggedWallId: AnyNodeId,
  originalStart: WallPlanPoint,
  originalEnd: WallPlanPoint,
): Array<{ id: AnyNodeId; start: WallPlanPoint; end: WallPlanPoint }> {
  const linked: Array<{ id: AnyNodeId; start: WallPlanPoint; end: WallPlanPoint }> = []
  for (const node of Object.values(nodes)) {
    if (node?.type !== 'wall') continue
    if (node.id === draggedWallId) continue
    const wall = node as WallNode
    if (
      pointsEqual(wall.start, originalStart) ||
      pointsEqual(wall.start, originalEnd) ||
      pointsEqual(wall.end, originalStart) ||
      pointsEqual(wall.end, originalEnd)
    ) {
      linked.push({
        id: wall.id,
        start: [...wall.start] as WallPlanPoint,
        end: [...wall.end] as WallPlanPoint,
      })
    }
  }
  return linked
}

/**
 * Wall curve sagitta drag — 1:1 port of the legacy
 * `handleWallCurvePointerDown` + commit flow. Drag projects the pointer
 * onto the chord normal to compute a `curveOffset`, snapped to the
 * grid step, clamped to `getMaxWallCurveOffset`,
 * normalized via `normalizeWallCurveOffset`. Same single-undo dance as
 * the move-endpoint affordance — the dispatcher handles snapshot /
 * pause / resume around `apply`.
 */
export const wallCurveAffordance: FloorplanAffordance<WallNode> = {
  start({ node }): FloorplanAffordanceSession {
    // Chord frame is fixed for the duration of the drag — only the
    // pointer projection along its normal changes.
    const chord = getWallChordFrame(node)
    const maxOffset = getMaxWallCurveOffset(node)
    const wallId = node.id as AnyNodeId
    let lastCurveOffset = node.curveOffset ?? 0

    return {
      affectedIds: [node.id],
      apply({ planPoint }) {
        const snapStep = getSegmentGridStep()
        // World-grid snap so a rotated building doesn't drag the curve
        // handle off the visible grid.
        const [x, y] = snapBuildingLocalToWorldGrid([planPoint[0], planPoint[1]], snapStep)

        // Signed projection of (snappedPoint - chord midpoint) onto the
        // chord normal. Legacy negates because the SVG y-axis flips
        // relative to plan y; the registry layer doesn't apply that flip
        // so the projection runs against the same normal the 3D tool
        // uses (which also has no flip). The result matches the 3D port
        // in `nodes/src/wall/curve-tool.tsx`.
        const offsetFromMidpoint = -(
          (x - chord.midpoint.x) * chord.normal.x +
          (y - chord.midpoint.y) * chord.normal.y
        )
        const snappedOffset = snapScalarToGrid(offsetFromMidpoint, snapStep)
        const nextCurveOffset = normalizeWallCurveOffset(
          node,
          Math.max(-maxOffset, Math.min(maxOffset, snappedOffset)),
        )
        lastCurveOffset = nextCurveOffset

        // Publish the curve preview as a live override so renderers see
        // it without zustand churn. Mark the wall dirty so `WallSystem`
        // rebuilds the geometry next frame using the override-merged
        // node.
        useLiveNodeOverrides.getState().set(wallId, { curveOffset: nextCurveOffset })
        useScene.getState().markDirty(wallId)
      },
      canCommit() {
        // Curve drag is always commit-eligible — the offset is already
        // clamped + normalized so we never end up in an invalid state.
        return true
      },
      commit() {
        // Atomic, tracked write of the final curve offset, then drop
        // the override so the scene state is the single source of
        // truth again.
        useScene.getState().updateNodes([{ id: wallId, data: { curveOffset: lastCurveOffset } }])
        useLiveNodeOverrides.getState().clear(wallId)
      },
    }
  },
}

export const wallMoveEndpointAffordance: FloorplanAffordance<WallNode> = {
  start({ node, payload, nodes }): FloorplanAffordanceSession {
    const { endpoint } = payload as WallEndpointPayload
    const fixedPoint: WallPlanPoint =
      endpoint === 'start' ? ([...node.end] as WallPlanPoint) : ([...node.start] as WallPlanPoint)
    const originalStart: WallPlanPoint = [...node.start] as WallPlanPoint
    const originalEnd: WallPlanPoint = [...node.end] as WallPlanPoint
    const linkedWalls = collectLinkedWalls(nodes, node.id, originalStart, originalEnd)
    const affectedIds: AnyNodeId[] = [node.id, ...linkedWalls.map((w) => w.id)]

    // Remember the latest preview so `commit()` can write it tracked.
    let lastPrimaryStart: WallPlanPoint = originalStart
    let lastPrimaryEnd: WallPlanPoint = originalEnd
    let lastLinkedUpdates: Array<{ id: AnyNodeId; start: WallPlanPoint; end: WallPlanPoint }> = []

    return {
      affectedIds,
      apply({ planPoint, modifiers }) {
        // Re-collect walls every tick so the snap pipeline sees fresh
        // positions (matters when the user releases + re-grabs without
        // unmounting the layer). Snap reads from scene — which holds
        // the pre-drag positions throughout — so the linked-wall snap
        // targets stay anchored to where corners *were*, exactly like
        // the legacy flow.
        const sceneNodes = useScene.getState().nodes
        const walls = collectLevelWalls(sceneNodes, node.id)
        // The grid step follows the active snapping mode (`getSegmentGridStep()`
        // is 0 outside grid mode), so `'lines' / 'angles' / 'off'` no longer
        // force a grid snap the mode chip says is inactive. In `'angles'` mode
        // the endpoint angle-locks off the fixed corner (free length), matching
        // the draft tool — the angle path ignores the `gridSnap` override.
        const angleLocked = isAngleSnapActive()
        const snapped = snapWallDraftPoint({
          point: planPoint as WallPlanPoint,
          walls,
          ignoreWallIds: [node.id],
          start: angleLocked ? fixedPoint : undefined,
          angleSnap: angleLocked,
          magnetic: isMagneticSnapActive(),
          gridSnap: (p) => snapBuildingLocalToWorldGrid(p, getSegmentGridStep()),
        })
        // Figma-style alignment on the dragged corner — snaps it onto another
        // object's edge / wall face and publishes a guide. The guide is
        // DISPLAYED in every mode except Off (isAlignmentGuideActive); the
        // magnetic pull onto it is applied only in 'lines' mode
        // (isMagneticSnapActive), like the draft tool does. The dragged wall and
        // its linked siblings (which cascade with the corner) are excluded from
        // the candidate pool. Alt is detach, NOT bypass.
        const aligned = alignFloorplanDraftPoint(snapped, {
          applySnap: isMagneticSnapActive(),
          bypass: !isAlignmentGuideActive(),
          excludeIds: [node.id, ...linkedWalls.map((w) => w.id)],
        }) as WallPlanPoint

        const primaryStart: WallPlanPoint = endpoint === 'start' ? aligned : fixedPoint
        const primaryEnd: WallPlanPoint = endpoint === 'end' ? aligned : fixedPoint

        // ALT detaches: the linked walls keep their original endpoints,
        // and only the dragged wall moves.
        const linkedUpdates = modifiers.altKey
          ? []
          : linkedWalls.map((w) => ({
              id: w.id,
              start: pointsEqual(w.start, originalStart)
                ? primaryStart
                : pointsEqual(w.start, originalEnd)
                  ? primaryEnd
                  : w.start,
              end: pointsEqual(w.end, originalStart)
                ? primaryStart
                : pointsEqual(w.end, originalEnd)
                  ? primaryEnd
                  : w.end,
            }))

        lastPrimaryStart = primaryStart
        lastPrimaryEnd = primaryEnd
        lastLinkedUpdates = linkedUpdates

        // Publish overrides instead of writing to scene. WallSystem +
        // 2D layer + sidebar panel merge these in. Marking dirty
        // wakes the system's `useFrame` rebuild pass.
        const overrides = useLiveNodeOverrides.getState()
        const sceneState = useScene.getState()
        overrides.set(node.id as AnyNodeId, { start: primaryStart, end: primaryEnd })
        sceneState.markDirty(node.id as AnyNodeId)
        for (const upd of linkedUpdates) {
          overrides.set(upd.id, { start: upd.start, end: upd.end })
          sceneState.markDirty(upd.id)
        }
      },
      canCommit() {
        // Pointer-up always runs canCommit — drop the alignment guide here
        // so it doesn't linger after a commit / reject.
        useAlignmentGuides.getState().clear()
        // The dragged wall must still be long enough at the preview
        // length — checked against `lastPrimary*`, not scene, because
        // scene holds baseline values until commit().
        return isSegmentLongEnough(lastPrimaryStart, lastPrimaryEnd)
      },
      commit() {
        // Atomic tracked write of the final endpoints, then drop the
        // overrides so the scene state is the single source of truth
        // again.
        useScene.getState().updateNodes([
          { id: node.id, data: { start: lastPrimaryStart, end: lastPrimaryEnd } },
          ...lastLinkedUpdates.map((u) => ({
            id: u.id,
            data: { start: u.start, end: u.end },
          })),
        ])
        const overrides = useLiveNodeOverrides.getState()
        overrides.clear(node.id as AnyNodeId)
        for (const upd of lastLinkedUpdates) overrides.clear(upd.id)
      },
    }
  },
}

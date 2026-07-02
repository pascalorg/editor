import {
  type AnyNode,
  type AnyNodeId,
  type FenceNode,
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
  type FencePlanPoint,
  getSegmentGridStep,
  isAlignmentGuideActive,
  isAngleSnapActive,
  isGridSnapActive,
  isMagneticSnapActive,
  isSegmentLongEnough,
  snapBuildingLocalToWorldGrid,
  snapFenceDraftPoint,
  snapScalarToGrid,
  useAlignmentGuides,
} from '@pascal-app/editor'

/**
 * Floor-plan 2D drag affordances for fence — sister to the 3D
 * `actions/move-endpoint.ts` `DragAction`. Same legacy interaction
 * (endpoint snap pipeline + linked-fence cascade via `endpoint-match`
 * with an epsilon, ALT-detach), driven from SVG pointer events instead
 * of R3F grid events.
 *
 * Why not share the `DragAction`? The 3D code goes through
 * `createDragSession` which assumes a `SceneApi`-style helper bag
 * (snapshot, restoreAll, pauseHistory, resumeHistory). The 2D registry
 * layer owns those semantics directly via the dispatcher's snapshot +
 * pause/resume dance, so the affordance only needs the pure mutation
 * logic. The shape is intentionally close to the legacy fence drag —
 * 1:1 behaviorally.
 */

const LINKED_FENCE_ENDPOINT_EPSILON = 0.025

type FenceEndpointPayload = { fenceId: AnyNodeId; endpoint: 'start' | 'end' }
type FenceControlPointPayload = { fenceId: AnyNodeId; index: number }
type FenceTangentPayload = { fenceId: AnyNodeId; index: number; side: 'in' | 'out' }

// Must match the floorplan builder's TANGENT_HANDLE_ARM_SCALE: the on-screen
// arm is this many times the raw tangent vector, so dividing the dragged
// offset back out recovers the stored tangent.
const TANGENT_HANDLE_ARM_SCALE = 3

function pointsNearlyEqual(a: FencePlanPoint, b: FencePlanPoint): boolean {
  return (
    Math.abs(a[0] - b[0]) <= LINKED_FENCE_ENDPOINT_EPSILON &&
    Math.abs(a[1] - b[1]) <= LINKED_FENCE_ENDPOINT_EPSILON
  )
}

function collectLevel(
  nodes: Record<AnyNodeId, AnyNode>,
  parentId: string | null,
): { walls: WallNode[]; fences: FenceNode[] } {
  const walls: WallNode[] = []
  const fences: FenceNode[] = []
  for (const node of Object.values(nodes)) {
    if (!node) continue
    if ((node.parentId ?? null) !== parentId) continue
    if (node.type === 'wall') walls.push(node as WallNode)
    else if (node.type === 'fence') fences.push(node as FenceNode)
  }
  return { walls, fences }
}

function collectLinkedFences(
  fences: FenceNode[],
  draggedFenceId: AnyNodeId,
  linkedPoint: FencePlanPoint,
): Array<{ id: AnyNodeId; start: FencePlanPoint; end: FencePlanPoint }> {
  const out: Array<{ id: AnyNodeId; start: FencePlanPoint; end: FencePlanPoint }> = []
  for (const fence of fences) {
    if (fence.id === draggedFenceId) continue
    if (!pointsNearlyEqual(fence.start, linkedPoint) && !pointsNearlyEqual(fence.end, linkedPoint))
      continue
    out.push({
      id: fence.id,
      start: [fence.start[0], fence.start[1]],
      end: [fence.end[0], fence.end[1]],
    })
  }
  return out
}

/**
 * Fence curve sagitta drag — 1:1 mirror of `wallCurveAffordance`. Drag
 * projects the pointer onto the chord normal to compute `curveOffset`,
 * snaps to grid when that mode is active, clamps to `getMaxWallCurveOffset`,
 * normalizes via `normalizeWallCurveOffset`. Same single-undo dance — the
 * dispatcher handles snapshot / pause / resume around `apply`. Lives in
 * the same file as the endpoint affordance to keep the two fence
 * floor-plan drags side-by-side (both publish to `useLiveNodeOverrides`,
 * both committed on pointer-up).
 */
export const fenceCurveAffordance: FloorplanAffordance<FenceNode> = {
  start({ node }): FloorplanAffordanceSession {
    const chord = getWallChordFrame(node)
    const maxOffset = getMaxWallCurveOffset(node)
    const fenceId = node.id as AnyNodeId
    let lastCurveOffset = node.curveOffset ?? 0

    return {
      affectedIds: [node.id],
      apply({ planPoint, modifiers }) {
        const snapStep = isGridSnapActive() ? getSegmentGridStep() : 0
        const x = snapStep > 0 ? snapScalarToGrid(planPoint[0], snapStep) : planPoint[0]
        const y = snapStep > 0 ? snapScalarToGrid(planPoint[1], snapStep) : planPoint[1]

        const offsetFromMidpoint = -(
          (x - chord.midpoint.x) * chord.normal.x +
          (y - chord.midpoint.y) * chord.normal.y
        )
        const snappedOffset =
          snapStep > 0 ? snapScalarToGrid(offsetFromMidpoint, snapStep) : offsetFromMidpoint
        const nextCurveOffset = normalizeWallCurveOffset(
          node,
          Math.max(-maxOffset, Math.min(maxOffset, snappedOffset)),
        )
        lastCurveOffset = nextCurveOffset

        useLiveNodeOverrides.getState().set(fenceId, { curveOffset: nextCurveOffset })
        useScene.getState().markDirty(fenceId)
      },
      canCommit() {
        return true
      },
      commit() {
        useScene.getState().updateNodes([{ id: fenceId, data: { curveOffset: lastCurveOffset } }])
        useLiveNodeOverrides.getState().clear(fenceId)
      },
    }
  },
}

/**
 * Spline control-point drag — reshapes one point of the fence `path`. Grid
 * snap follows the active mode; start/end stay pinned to the path ends so endpoint-
 * dependent code stays valid. Publishes a live override per tick, commits the
 * final path as one tracked change. No linked-fence cascade: a spline's shape
 * is self-contained.
 */
export const fenceControlPointAffordance: FloorplanAffordance<FenceNode> = {
  start({ node, payload }): FloorplanAffordanceSession {
    const { index } = payload as FenceControlPointPayload
    const fenceId = node.id as AnyNodeId
    const originalPath: FencePlanPoint[] = (node.path ?? []).map((p) => [p[0], p[1]])
    let lastPath = originalPath

    const buildPatch = (point: FencePlanPoint): Record<string, unknown> => {
      const nextPath = originalPath.map((p, i): FencePlanPoint => (i === index ? point : p))
      lastPath = nextPath
      const patch: Record<string, unknown> = { path: nextPath }
      if (index === 0) patch.start = point
      if (index === nextPath.length - 1) patch.end = point
      return patch
    }

    return {
      affectedIds: [fenceId],
      apply({ planPoint, modifiers }) {
        const snapStep = isGridSnapActive() ? getSegmentGridStep() : 0
        const x = snapStep > 0 ? snapScalarToGrid(planPoint[0], snapStep) : planPoint[0]
        const y = snapStep > 0 ? snapScalarToGrid(planPoint[1], snapStep) : planPoint[1]
        useLiveNodeOverrides.getState().set(fenceId, buildPatch([x, y]))
        useScene.getState().markDirty(fenceId)
      },
      canCommit() {
        return lastPath.length >= 2
      },
      commit() {
        const data: Partial<FenceNode> = { path: lastPath }
        data.start = lastPath[0]
        data.end = lastPath[lastPath.length - 1]
        useScene.getState().updateNodes([{ id: fenceId, data }])
        useLiveNodeOverrides.getState().clear(fenceId)
      },
    }
  },
}

/**
 * Spline tangent-handle drag — bends the curve through one control point. The
 * dragged end (in / out) gives the OUT-handle vector (negated for the IN end);
 * the IN handle is always the mirror so the curve stays smooth (symmetric).
 * The visual arm is `TANGENT_HANDLE_ARM_SCALE`× the stored vector, so we divide
 * that factor out before storing. Writes `tangents[index]`, padding the array
 * to the path length with nulls so untouched points keep their auto tangent.
 */
export const fenceTangentAffordance: FloorplanAffordance<FenceNode> = {
  start({ node, payload }): FloorplanAffordanceSession {
    const { index, side } = payload as FenceTangentPayload
    const fenceId = node.id as AnyNodeId
    const path = node.path ?? []
    const anchor = path[index] ?? node.start
    let lastTangents: Array<[number, number] | null> = (node.tangents ?? []).map((t) =>
      t ? [t[0], t[1]] : null,
    )

    const buildTangents = (vec: [number, number]): Array<[number, number] | null> => {
      const next: Array<[number, number] | null> = Array.from(
        { length: path.length },
        (_, i) => lastTangents[i] ?? null,
      )
      next[index] = vec
      lastTangents = next
      return next
    }

    return {
      affectedIds: [fenceId],
      apply({ planPoint, modifiers }) {
        const snapStep = isGridSnapActive() ? getSegmentGridStep() : 0
        const px = snapStep > 0 ? snapScalarToGrid(planPoint[0], snapStep) : planPoint[0]
        const py = snapStep > 0 ? snapScalarToGrid(planPoint[1], snapStep) : planPoint[1]
        // Arm vector from the anchor to the dragged handle, in plan meters.
        let armX = px - anchor[0]
        let armY = py - anchor[1]
        // The IN end is the mirror, so its drag describes the negated OUT vector.
        if (side === 'in') {
          armX = -armX
          armY = -armY
        }
        const vec: [number, number] = [
          armX / TANGENT_HANDLE_ARM_SCALE,
          armY / TANGENT_HANDLE_ARM_SCALE,
        ]
        useLiveNodeOverrides.getState().set(fenceId, { tangents: buildTangents(vec) })
        useScene.getState().markDirty(fenceId)
      },
      canCommit() {
        return true
      },
      commit() {
        useScene
          .getState()
          .updateNodes([{ id: fenceId, data: { tangents: lastTangents } as Partial<FenceNode> }])
        useLiveNodeOverrides.getState().clear(fenceId)
      },
    }
  },
}

export const fenceMoveEndpointAffordance: FloorplanAffordance<FenceNode> = {
  start({ node, payload, nodes }): FloorplanAffordanceSession {
    const { endpoint } = payload as FenceEndpointPayload
    const originalStart: FencePlanPoint = [node.start[0], node.start[1]]
    const originalEnd: FencePlanPoint = [node.end[0], node.end[1]]
    const originalMovingPoint = endpoint === 'start' ? originalStart : originalEnd
    const fixedPoint: FencePlanPoint = endpoint === 'start' ? originalEnd : originalStart

    const parentId = node.parentId ?? null
    const { walls, fences } = collectLevel(nodes, parentId)
    const linkedOriginals = collectLinkedFences(fences, node.id, originalMovingPoint)

    const affectedIds: AnyNodeId[] = [node.id, ...linkedOriginals.map((l) => l.id)]

    return {
      affectedIds,
      apply({ planPoint, modifiers }) {
        // Re-collect siblings each tick: the user might be dragging a
        // fence whose sibling positions changed (the dragged fence
        // itself is excluded via `ignoreFenceIds`).
        const sceneNodes = useScene.getState().nodes
        const { walls: nextWalls, fences: nextFences } = collectLevel(sceneNodes, parentId)
        // The grid step follows the active snapping mode (`getSegmentGridStep()`
        // is 0 outside grid mode), so `'lines' / 'angles' / 'off'` no longer
        // force a grid snap the mode chip says is inactive — matching the wall
        // endpoint affordance. In `'angles'` mode the endpoint angle-locks off
        // the fixed corner (free length); the angle path ignores `gridSnap`.
        const angleLocked = isAngleSnapActive()
        const snapped = snapFenceDraftPoint({
          point: planPoint as FencePlanPoint,
          walls: nextWalls,
          fences: nextFences,
          ignoreFenceIds: [node.id],
          start: angleLocked ? fixedPoint : undefined,
          angleSnap: angleLocked,
          magnetic: isMagneticSnapActive(),
          gridSnap: (p) => snapBuildingLocalToWorldGrid(p, getSegmentGridStep()) as FencePlanPoint,
        })
        // Figma-style alignment on the dragged endpoint — snaps it onto
        // another object's edge / wall face and publishes a guide, matching
        // the 3D fence endpoint action. The guide is DISPLAYED in every mode
        // except Off (isAlignmentGuideActive); the magnetic pull onto it is
        // applied only in 'lines' mode (isMagneticSnapActive). The dragged fence
        // and its linked siblings (which cascade with the endpoint) are excluded
        // from the candidate pool. Alt is reserved for detach here, NOT bypass.
        const aligned = alignFloorplanDraftPoint(snapped, {
          applySnap: isMagneticSnapActive(),
          bypass: !isAlignmentGuideActive(),
          excludeIds: [node.id, ...linkedOriginals.map((l) => l.id)],
        }) as FencePlanPoint
        const nextStart = endpoint === 'start' ? aligned : fixedPoint
        const nextEnd = endpoint === 'end' ? aligned : fixedPoint

        const linkedUpdates = modifiers.altKey
          ? []
          : linkedOriginals.map((l) => ({
              id: l.id,
              start: pointsNearlyEqual(l.start, originalMovingPoint) ? aligned : l.start,
              end: pointsNearlyEqual(l.end, originalMovingPoint) ? aligned : l.end,
            }))

        useScene.getState().updateNodes([
          { id: node.id, data: { start: nextStart, end: nextEnd } },
          ...linkedUpdates.map((u) => ({
            id: u.id,
            data: { start: u.start, end: u.end },
          })),
        ])
      },
      canCommit() {
        // Pointer-up always runs canCommit — drop the alignment guide here
        // so it doesn't linger after a commit / reject.
        useAlignmentGuides.getState().clear()
        const finalFence = useScene.getState().nodes[node.id] as FenceNode | undefined
        return (
          !!finalFence &&
          finalFence.type === 'fence' &&
          isSegmentLongEnough(finalFence.start, finalFence.end)
        )
      },
    }
  },
}

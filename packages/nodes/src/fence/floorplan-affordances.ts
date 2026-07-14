import {
  type AnyNode,
  type AnyNodeId,
  type FenceNode,
  type FloorplanAffordance,
  type FloorplanAffordanceSession,
  useScene,
  type WallNode,
} from '@pascal-app/core'
import { type FencePlanPoint, isWallLongEnough, snapFenceDraftPoint } from '@pascal-app/editor'

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

export const fenceMoveEndpointAffordance: FloorplanAffordance<FenceNode> = {
  start({ node, payload, nodes }): FloorplanAffordanceSession {
    const { endpoint } = payload as FenceEndpointPayload
    const originalStart: FencePlanPoint = [node.start[0], node.start[1]]
    const originalEnd: FencePlanPoint = [node.end[0], node.end[1]]
    const originalMovingPoint = endpoint === 'start' ? originalStart : originalEnd
    const fixedPoint: FencePlanPoint = endpoint === 'start' ? originalEnd : originalStart

    const parentId = node.parentId ?? null
    const { fences } = collectLevel(nodes, parentId)
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
        const snapped = snapFenceDraftPoint({
          point: planPoint as FencePlanPoint,
          walls: nextWalls,
          fences: nextFences,
          start: fixedPoint,
          angleSnap: !modifiers.shiftKey,
          ignoreFenceIds: [node.id],
        })
        const nextStart = endpoint === 'start' ? snapped : fixedPoint
        const nextEnd = endpoint === 'end' ? snapped : fixedPoint

        const linkedUpdates = modifiers.altKey
          ? []
          : linkedOriginals.map((l) => ({
              id: l.id,
              start: pointsNearlyEqual(l.start, originalMovingPoint) ? snapped : l.start,
              end: pointsNearlyEqual(l.end, originalMovingPoint) ? snapped : l.end,
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
        const finalFence = useScene.getState().nodes[node.id] as FenceNode | undefined
        return (
          !!finalFence &&
          finalFence.type === 'fence' &&
          isWallLongEnough(finalFence.start, finalFence.end)
        )
      },
    }
  },
}

import {
  type AnyNodeId,
  type DoorNode,
  type FloorplanAffordance,
  type FloorplanAffordanceSession,
  useLiveNodeOverrides,
  useScene,
  type WallNode,
} from '@pascal-app/core'

const MIN_DOOR_WIDTH = 0.3

type DoorWidthPayload = { side: 'start' | 'end' }

/**
 * 2D drag affordance for the door's width side-arrows. Sister to the 3D
 * `DoorSideArrow` width drag in `packages/editor/src/components/editor/
 * door-side-handles.tsx` — both anchor at the opposite door edge and clamp
 * to wall bounds.
 *
 * Payload encodes which edge the user grabbed:
 *   - `'start'`: arrow at the door edge closer to `wall.start`. The
 *     opposite edge (toward `wall.end`) stays fixed.
 *   - `'end'`: arrow at the edge closer to `wall.end`. The wall-start
 *     edge stays fixed.
 *
 * Preview state stays in the live override store so the scene graph is
 * written only once, when the drag commits.
 */
export const doorWidthAffordance: FloorplanAffordance<DoorNode> = {
  start({ node, payload, nodes, initialPlanPoint }): FloorplanAffordanceSession {
    const { side } = payload as DoorWidthPayload
    const doorId = node.id as AnyNodeId
    const wall = node.wallId ? (nodes[node.wallId as AnyNodeId] as WallNode | undefined) : undefined

    const initialWidth = node.width
    const initialDoorX = node.position[0]
    const initialDoorY = node.position[1]
    const initialDoorZ = node.position[2]

    // Anchor (wall-local X) is the door edge OPPOSITE to the dragged
    // side. Grow direction along the wall: +1 for 'end' (drag outward
    // toward wall.end), -1 for 'start' (drag outward toward wall.start).
    const growDir = side === 'end' ? 1 : -1
    const anchorX =
      side === 'end' ? initialDoorX - initialWidth / 2 : initialDoorX + initialWidth / 2

    // Wall axis (level-local) for projecting pointer movement to a
    // wall-local X delta.
    const wallStart: readonly [number, number] = wall ? wall.start : [0, 0]
    const wallEnd: readonly [number, number] = wall ? wall.end : [1, 0]
    const dx = wallEnd[0] - wallStart[0]
    const dz = wallEnd[1] - wallStart[1]
    const wallLength = Math.hypot(dx, dz) || 1
    const dirX = dx / wallLength
    const dirZ = dz / wallLength

    // Max width keeps the dragged edge inside the wall span. With the
    // anchor fixed, the moving edge is `anchorX ± width`, so the largest
    // legal width is the headroom on the grow side.
    const maxWidth = growDir > 0 ? wallLength - anchorX : anchorX

    const projectToWallLocalX = (planPoint: readonly [number, number]) => {
      return (planPoint[0] - wallStart[0]) * dirX + (planPoint[1] - wallStart[1]) * dirZ
    }

    // Initial pointer in wall-local X — anchored to where the user
    // actually pressed, so any subtle offset between the arrow's visual
    // origin and the click point doesn't pre-bias the width delta.
    const initialPointerLocalX = projectToWallLocalX(initialPlanPoint)

    let lastWidth = initialWidth
    let lastDoorX = initialDoorX

    return {
      affectedIds: [node.id],
      apply({ planPoint }) {
        const currentLocalX = projectToWallLocalX(planPoint)
        const delta = (currentLocalX - initialPointerLocalX) * growDir
        const newWidth = Math.min(
          Math.max(MIN_DOOR_WIDTH, initialWidth + delta),
          Math.max(MIN_DOOR_WIDTH, maxWidth),
        )
        const newDoorX = anchorX + growDir * (newWidth / 2)
        lastWidth = newWidth
        lastDoorX = newDoorX
        useLiveNodeOverrides.getState().set(doorId, {
          width: newWidth,
          position: [newDoorX, initialDoorY, initialDoorZ],
        })
        useScene.getState().markDirty(doorId)
      },
      canCommit() {
        // Width is always clamped to >= MIN_DOOR_WIDTH inside apply, so
        // any committed state is legal.
        return true
      },
      commit() {
        // Atomic, tracked final write. Owning the commit ourselves
        // bypasses the dispatcher's diff path (which only re-applies
        // fields that differ from the pre-drag snapshot — if the user
        // drags back to the original size by accident, the diff is empty
        // and the door would otherwise revert to its starting state).
        useLiveNodeOverrides.getState().clear(doorId)
        useScene.getState().updateNodes([
          {
            id: doorId,
            data: {
              width: lastWidth,
              position: [lastDoorX, initialDoorY, initialDoorZ],
            },
          },
        ])
      },
    }
  },
}

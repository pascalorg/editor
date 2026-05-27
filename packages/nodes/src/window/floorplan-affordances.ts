import {
  type AnyNodeId,
  type FloorplanAffordance,
  type FloorplanAffordanceSession,
  useScene,
  type WallNode,
  type WindowNode,
} from '@pascal-app/core'

const MIN_WINDOW_WIDTH = 0.3

type WindowWidthPayload = { side: 'start' | 'end' }

/**
 * 2D drag affordance for the window's width side-arrows. Sister to the 3D
 * `WindowSideArrow` width drag in `packages/editor/src/components/editor/
 * window-side-handles.tsx` — both anchor at the opposite window edge and
 * clamp to wall bounds. Mirrors `doorWidthAffordance` 1:1 with the door
 * type swapped for the window type.
 *
 * Payload encodes which edge the user grabbed:
 *   - `'start'`: arrow at the window edge closer to `wall.start`. The
 *     opposite edge (toward `wall.end`) stays fixed.
 *   - `'end'`: arrow at the edge closer to `wall.end`. The wall-start
 *     edge stays fixed.
 *
 * Uses the scene-write preview pattern (writes directly to `useScene`
 * each tick): the registry layer's `effectiveNode` only merges live
 * overrides for walls, so an override-based preview wouldn't show on
 * windows. The dispatcher snapshots / pauses history at start, so
 * per-tick scene writes still collapse to one undoable entry on commit.
 */
export const windowWidthAffordance: FloorplanAffordance<WindowNode> = {
  start({ node, payload, nodes, initialPlanPoint }): FloorplanAffordanceSession {
    const { side } = payload as WindowWidthPayload
    const windowId = node.id as AnyNodeId
    const wall = node.wallId ? (nodes[node.wallId as AnyNodeId] as WallNode | undefined) : undefined

    const initialWidth = node.width
    const initialWindowX = node.position[0]
    const initialWindowY = node.position[1]
    const initialWindowZ = node.position[2]

    const growDir = side === 'end' ? 1 : -1
    const anchorX =
      side === 'end' ? initialWindowX - initialWidth / 2 : initialWindowX + initialWidth / 2

    const wallStart: readonly [number, number] = wall ? wall.start : [0, 0]
    const wallEnd: readonly [number, number] = wall ? wall.end : [1, 0]
    const dx = wallEnd[0] - wallStart[0]
    const dz = wallEnd[1] - wallStart[1]
    const wallLength = Math.hypot(dx, dz) || 1
    const dirX = dx / wallLength
    const dirZ = dz / wallLength

    const maxWidth = growDir > 0 ? wallLength - anchorX : anchorX

    const projectToWallLocalX = (planPoint: readonly [number, number]) => {
      return (planPoint[0] - wallStart[0]) * dirX + (planPoint[1] - wallStart[1]) * dirZ
    }

    const initialPointerLocalX = projectToWallLocalX(initialPlanPoint)

    let lastWidth = initialWidth
    let lastWindowX = initialWindowX

    return {
      affectedIds: [node.id],
      apply({ planPoint }) {
        const currentLocalX = projectToWallLocalX(planPoint)
        const delta = (currentLocalX - initialPointerLocalX) * growDir
        const newWidth = Math.min(
          Math.max(MIN_WINDOW_WIDTH, initialWidth + delta),
          Math.max(MIN_WINDOW_WIDTH, maxWidth),
        )
        const newWindowX = anchorX + growDir * (newWidth / 2)
        lastWidth = newWidth
        lastWindowX = newWindowX
        useScene.getState().updateNodes([
          {
            id: windowId,
            data: {
              width: newWidth,
              position: [newWindowX, initialWindowY, initialWindowZ],
            },
          },
        ])
      },
      canCommit() {
        return true
      },
      commit() {
        useScene.getState().updateNodes([
          {
            id: windowId,
            data: {
              width: lastWidth,
              position: [lastWindowX, initialWindowY, initialWindowZ],
            },
          },
        ])
      },
    }
  },
}

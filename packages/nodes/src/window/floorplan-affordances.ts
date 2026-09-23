import {
  type AnyNodeId,
  type FloorplanAffordance,
  type FloorplanAffordanceSession,
  getWallCurveLength,
  useLiveNodeOverrides,
  useScene,
  type WallNode,
  type WindowNode,
} from '@pascal-app/core'
import { curtainOpeningLimits } from '../shared/curtain-opening-limits'
import { projectPlanPointToWallLocalX } from '../shared/wall-attach-target'

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
 * Preview state stays in the live override store so the scene graph is
 * written only once, when the drag commits.
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

    const wallLength = wall ? getWallCurveLength(wall) : 1

    const limits = curtainOpeningLimits(node, nodes)
    const margin = limits?.margin ?? 0
    const maxWidth =
      growDir > 0 ? (limits?.length ?? wallLength) - margin - anchorX : anchorX - margin

    const projectToWallLocalX = (planPoint: readonly [number, number]) => {
      return wall ? projectPlanPointToWallLocalX(wall, planPoint) : planPoint[0]
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
        useLiveNodeOverrides.getState().set(windowId, {
          width: newWidth,
          position: [newWindowX, initialWindowY, initialWindowZ],
        })
        useScene.getState().markDirty(windowId)
      },
      canCommit() {
        return true
      },
      commit() {
        useLiveNodeOverrides.getState().clear(windowId)
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

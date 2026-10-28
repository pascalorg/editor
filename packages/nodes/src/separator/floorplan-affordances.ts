import type {
  AnyNodeId,
  FloorplanAffordance,
  FloorplanAffordanceSession,
  SeparatorNode,
} from '@pascal-app/core'
import { beginSeparatorEndDrag } from '@pascal-app/editor'

type SeparatorEndpointPayload = { separatorId: AnyNodeId; endpoint: 'start' | 'end' }

/**
 * An invisible wall's end handle on the plan, the 2D twin of its 3D grip: the
 * same snapping, preview and commit (`beginSeparatorEndDrag`), the pointer read
 * by the floor plan. The invisible walls joined at that end follow it; Alt
 * leaves them where they are.
 */
export const separatorMoveEndpointAffordance: FloorplanAffordance<SeparatorNode> = {
  start({ node, payload }): FloorplanAffordanceSession {
    const { endpoint } = payload as SeparatorEndpointPayload
    const drag = beginSeparatorEndDrag(node.id, endpoint)
    return {
      affectedIds: drag?.affectedIds ?? [node.id],
      apply({ planPoint, modifiers }) {
        drag?.move([planPoint[0], planPoint[1]], modifiers.altKey)
      },
      canCommit: () => drag?.canCommit() ?? false,
      commit() {
        drag?.commit()
      },
    }
  },
}

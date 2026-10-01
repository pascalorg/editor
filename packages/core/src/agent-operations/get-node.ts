import { refuse } from '../agent-tools/refusal'
import { isFloorAnchoredOpening } from '../lib/floor-opening-footprints'
import { getOpeningFloorDatum } from '../lib/opening-floor-datum'
import type { AgentOperation } from './types'

/** `get_node`: a node, whole; a door or window also says where its floor is and what it hangs from. */
export const getNode: AgentOperation<{ id: string }> = (nodes, { id }) => {
  const node = nodes[id]
  if (!node) refuse('node_not_found', `Node not found: ${id}.`, { id })
  const wall = node.parentId ? nodes[node.parentId] : undefined
  const resolvedOpening =
    (node.type === 'door' || node.type === 'window') && wall?.type === 'wall'
      ? {
          floorDatum: getOpeningFloorDatum(wall, node, nodes),
          anchor: isFloorAnchoredOpening(node) ? 'floor' : 'wall',
        }
      : undefined
  return { result: { node: resolvedOpening ? { ...node, resolvedOpening } : node } }
}

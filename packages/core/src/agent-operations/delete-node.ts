import { refuse } from '../agent-tools/refusal'
import { descendantsOf } from './scene-queries'
import type { AgentOperation } from './types'

/** `delete_node`: the editor's Delete, which takes a node with everything under it. */
export const deleteNode: AgentOperation<{ id: string }> = (nodes, { id }) => {
  if (!nodes[id]) refuse('node_not_found', `Node not found: ${id}.`, { id })
  const deletedIds = [id, ...descendantsOf(nodes, id).map((node) => node.id)]
  return { result: { deletedIds }, changes: { delete: [id] } }
}

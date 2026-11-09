import { refuse } from '../agent-tools/refusal'
import { achievedChanges } from './achieved'
import { type MoveTarget, planNodeMove } from './move-plan'
import type { AgentOperation } from './types'

type MoveNodeInput = MoveTarget & { id: string }

/**
 * `move_node`: the editor's move tool for one node — re-seated on its host by `planNodeMove`,
 * so the node the agent leaves is the node the editor's drag would leave.
 */
export const moveNode: AgentOperation<MoveNodeInput> = (nodes, input) => {
  const node = nodes[input.id]
  if (!node) refuse('node_not_found', `Node not found: ${input.id}.`, { id: input.id })
  const plan = planNodeMove(nodes, node, input)
  const changes = { update: [{ id: node.id, data: plan.data }] }
  return {
    result: {
      ok: true as const,
      id: node.id,
      type: node.type,
      host: plan.host,
      hostId: plan.hostId,
      position: plan.position,
      clamped: plan.clamped,
      message: `Moved ${node.type} "${node.name ?? node.id}"${plan.clamped ? ', slid to stay seated' : ''}`,
      achieved: achievedChanges(nodes, changes),
    },
    changes,
  }
}

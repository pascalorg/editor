import { refuse } from '../agent-tools/refusal'
import { getLevelDisplayName } from '../lib/level-name'
import type { LevelNode } from '../schema'
import { planRoofsOffStorey } from '../services/roof-move'
import { requireLevel } from './level-target'
import type { AgentOperation } from './types'

/**
 * `move_roofs_to_roof_level`: the roof panel's "Move to the roof level" for agents. The roofs a
 * storey holds on its own walls go to the level the rule gives them, standing where they stood.
 */
export const moveRoofsToRoofLevel: AgentOperation<{ levelId: string }> = (nodes, input) => {
  const storey = requireLevel(nodes, input.levelId)
  const move = planRoofsOffStorey(nodes, storey.id)
  const name = `${getLevelDisplayName(storey)} (${storey.id})`
  if (!move)
    refuse(
      'no_roof_on_walls',
      `${name} holds no roof standing on its walls, so none hides its plan: a porch roof on its beam and a lower wing's roof on the storey above already sit where they belong.`,
      { levelId: storey.id },
    )
  const roofIds = move.changes.update
    .filter(({ id }) => nodes[id]?.type === 'roof')
    .map(({ id }) => id)
  const created = move.plan.kind === 'roof' ? move.plan.create : null
  const target = (created ?? nodes[move.plan.levelId]) as LevelNode
  return {
    result: {
      roofIds,
      roofLevelId: move.plan.levelId,
      createdRoofLevelId: created?.id ?? null,
      message: `Moved ${roofIds.length} roof${roofIds.length === 1 ? '' : 's'} off ${name} onto ${getLevelDisplayName(target)} (${target.id}), standing where ${roofIds.length === 1 ? 'it' : 'they'} stood.`,
    },
    changes: move.changes,
  }
}

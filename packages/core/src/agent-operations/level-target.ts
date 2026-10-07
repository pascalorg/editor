import { refuse } from '../agent-tools/refusal'
import type { LevelNode } from '../schema'
import { levelRole, levelsOf } from './scene-queries'
import type { AgentContext, SceneNodes } from './types'

export type LevelTargetInput = { levelId?: string; level?: string }

/** A level named by id, or a refusal saying what the id is instead. */
export function requireLevel(nodes: SceneNodes, levelId: string): LevelNode {
  const node = nodes[levelId]
  if (!node)
    refuse('level_not_found', `Level not found: ${levelId}. Use an id list_levels returned.`, {
      levelId,
    })
  if (node.type !== 'level')
    refuse('not_a_level', `Node ${levelId} is a ${node.type}, not a level.`, {
      levelId,
      type: node.type,
    })
  return node
}

/** The level a read targets: the one named, else the viewed floor, else the lowest storey. */
export function targetLevel(
  nodes: SceneNodes,
  { levelId, level }: LevelTargetInput,
  context: AgentContext,
): LevelNode {
  if (levelId && level && levelId !== level)
    refuse(
      'conflicting_level',
      `levelId (${levelId}) and level (${level}) disagree; they are the same field, pass one.`,
      { levelId, level },
    )
  const named = levelId ?? level ?? context.activeLevelId
  if (named) return requireLevel(nodes, named)
  const levels = levelsOf(nodes)
  const lowest = levels.find((entry) => levelRole(nodes, entry).role === 'occupied') ?? levels[0]
  if (!lowest) refuse('no_levels', 'The scene has no level yet.')
  return lowest
}

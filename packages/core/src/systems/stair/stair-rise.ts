import type { AnyNode, StairNode } from '../../schema'
import { DEFAULT_LEVEL_HEIGHT } from '../../services/level-height'
import { getStoredLevelHeight } from '../../services/storey'

export function resolveStairTotalRise(stair: StairNode, nodes: Record<string, AnyNode>): number {
  if (stair.totalRise !== undefined) return stair.totalRise

  const level = Object.values(nodes).find(
    (node) => node.type === 'level' && node.children.includes(stair.id),
  )
  return level?.type === 'level' ? getStoredLevelHeight(level) : DEFAULT_LEVEL_HEIGHT
}

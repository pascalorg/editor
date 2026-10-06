import { refuse } from '../agent-tools/refusal'
import {
  buildLevelDuplicateCreateOps,
  type LevelDuplicatePreset,
  levelBuildingId,
} from '../building/level-duplication'
import { getLevelDisplayName } from '../lib/level-name'
import type { AnyNode, AnyNodeId, LevelNode } from '../schema'
import { requireLevel } from './level-target'
import { levelsOf } from './scene-queries'
import type { AgentOperation } from './types'

type DuplicateLevelInput = {
  levelId?: string
  position?: 'above' | 'below'
  name?: string
  preset?: LevelDuplicatePreset
}

const countByType = (nodes: readonly AnyNode[]) => {
  const counts: Record<string, number> = {}
  for (const node of nodes) counts[node.type] = (counts[node.type] ?? 0) + 1
  return counts
}

/** `duplicate_level`: the editor's level duplication, above or below the original. */
export const duplicateLevel: AgentOperation<DuplicateLevelInput> = (nodes, input, context) => {
  const levelId = input.levelId ?? context.activeLevelId
  if (!levelId) refuse('level_required', 'Say which level to copy: a levelId from list_levels.')
  const level = requireLevel(nodes, levelId)
  const all = nodes as Record<AnyNodeId, AnyNode>
  const buildingId = levelBuildingId(all, level)
  const building = buildingId ? nodes[buildingId] : undefined
  if (building?.type !== 'building')
    refuse('no_building', `Level ${levelId} is not in a building, so it has no floors to join.`, {
      levelId,
    })

  const { createOps, newLevelId, shiftedLevels, updateOps, skippedNodes } =
    buildLevelDuplicateCreateOps({
      nodes: all,
      level,
      levels: levelsOf(nodes).filter(
        (entry) => entry.parentId === building.id || building.children.includes(entry.id),
      ),
      preset: input.preset ?? 'everything',
      position: input.position ?? 'above',
    })
  const create = createOps.map(({ node, parentId }) => ({
    node: node.id === newLevelId && input.name ? ({ ...node, name: input.name } as AnyNode) : node,
    parentId,
  }))
  const copy = create.find(({ node }) => node.id === newLevelId)!.node as LevelNode

  return {
    result: {
      newLevelId,
      name: getLevelDisplayName(copy),
      floorIndex: copy.level,
      shiftedLevelIds: shiftedLevels.map((entry) => entry.id),
      copied: countByType(create.map(({ node }) => node)),
      skipped: countByType(skippedNodes),
      // Counts are in `copied`; a floor copy is hundreds of ids the model reads back every call.
      newNodeIds: create.slice(0, 40).map(({ node }) => node.id),
      ...(create.length > 40 ? { newNodeIdsOmitted: create.length - 40 } : {}),
    },
    changes: {
      create,
      update: updateOps,
    },
  }
}

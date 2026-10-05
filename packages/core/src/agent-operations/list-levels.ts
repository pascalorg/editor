import { levelRole, levelsOf } from './scene-queries'
import type { AgentOperation } from './types'

/** `list_levels`: every level of every building, in floor order, with its role. */
export const listLevels: AgentOperation = (nodes, _input, context) => {
  const levels = levelsOf(nodes).map((level) => {
    const { role, metadataRole, referenceLevelId } = levelRole(nodes, level)
    return {
      id: level.id,
      name: level.name,
      floorIndex: level.level,
      parentId: level.parentId,
      role,
      metadataRole,
      isOccupiedStory: role === 'occupied',
      isSupportLevel: role !== 'occupied',
      referenceLevelId,
      childCount: Array.isArray(level.children) ? level.children.length : 0,
      isActive: level.id === context.activeLevelId,
    }
  })
  const occupiedStoryCount = levels.filter((level) => level.isOccupiedStory).length
  return {
    result: {
      activeLevelId: context.activeLevelId,
      levelCount: levels.length,
      occupiedStoryCount,
      supportLevelCount: levels.length - occupiedStoryCount,
      roofLevelIds: levels.filter((level) => level.role === 'roof').map((level) => level.id),
      levels,
    },
  }
}

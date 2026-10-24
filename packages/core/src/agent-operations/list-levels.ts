import { levelGradeStanding } from '../lib/grade-standing'
import { groundSeat } from '../lib/ground-seat'
import type { AnyNode, AnyNodeId } from '../schema'
import { levelRole, levelsOf, queryNodes } from './scene-queries'
import type { AgentOperation } from './types'

/** `list_levels`: every level of every building, in floor order, with its role. */
export const listLevels: AgentOperation = (nodes, _input, context) => {
  const groundLevels = queryNodes(nodes, { type: 'building' }).flatMap((building) => {
    const seat = groundSeat(nodes as Record<AnyNodeId, AnyNode>, building.id)
    return seat
      ? [
          {
            buildingId: building.id,
            levelId: seat.levelId,
            named: seat.explicit,
            floorElevation: seat.floorElevation,
            gradeElevation: seat.gradeElevation,
            floorOverGrade: Math.round(seat.offset * 1000) / 1000,
            seated: seat.seated,
          },
        ]
      : []
  })
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
      gradeStanding: levelGradeStanding(nodes as Record<AnyNodeId, AnyNode>, level.id),
      isGroundLevel: groundLevels.some((ground) => ground.levelId === level.id),
      isActive: level.id === context.activeLevelId,
    }
  })
  const occupiedStoryCount = levels.filter((level) => level.isOccupiedStory).length
  return {
    result: {
      activeLevelId: context.activeLevelId,
      groundLevels,
      levelCount: levels.length,
      occupiedStoryCount,
      supportLevelCount: levels.length - occupiedStoryCount,
      roofLevelIds: levels.filter((level) => level.role === 'roof').map((level) => level.id),
      levels,
    },
  }
}

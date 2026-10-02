import { deleteNode } from './delete-node'
import { duplicateLevel } from './duplicate-level'
import { getNode } from './get-node'
import { getLevelSummary, getWalls, getZones } from './level-reads'
import { listLevels } from './list-levels'
import { verifyScene } from './verify-scene'

export * from './apply-changes'
export * from './author-object'
export * from './delete-node'
export * from './door-clearance'
export * from './duplicate-level'
export * from './get-node'
export * from './layout-clearance'
export * from './level-reads'
export * from './level-target'
export * from './list-levels'
export * from './plan-geometry'
export * from './scene-queries'
export * from './types'
export * from './verify-scene'

/** Each shared agent tool's operation, by tool name: what every surface executes. */
export const AGENT_OPERATIONS = {
  list_levels: listLevels,
  get_node: getNode,
  get_level_summary: getLevelSummary,
  get_walls: getWalls,
  get_zones: getZones,
  duplicate_level: duplicateLevel,
  verify_scene: verifyScene,
  delete_node: deleteNode,
} as const

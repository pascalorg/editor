import { addLevel } from './add-level'
import { addWall } from './add-wall'
import { createRoom } from './create-room'
import { createStair } from './create-stair'
import { deleteNode } from './delete-node'
import { duplicateLevel } from './duplicate-level'
import { findByType } from './find-by-type'
import { furnishRoom } from './furnish-room'
import { getNode } from './get-node'
import { getLevelSummary, getWalls, getZones } from './level-reads'
import { listLevels } from './list-levels'
import { placeItems } from './place-items'
import { ROOM_OPERATIONS } from './room-structure'
import { searchAssets } from './search-assets'
import { verifyScene } from './verify-scene'

export * from './achieved'
export * from './add-column'
export * from './add-level'
export * from './add-object'
export * from './add-wall'
export * from './apply-changes'
export * from './apply-outcome'
export * from './collections'
export * from './create-room'
export * from './create-stair'
export * from './delete-node'
export * from './door-clearance'
export * from './duplicate-level'
export * from './find-by-type'
export * from './furnish-room'
export * from './get-node'
export * from './layout-clearance'
export * from './level-reads'
export * from './level-target'
export * from './list-levels'
export * from './material-preset'
export * from './place-items'
export * from './plan-geometry'
export * from './room-structure'
export * from './scene-measure'
export * from './scene-queries'
export * from './search-assets'
export * from './types'
export * from './verify-scene'
export * from './wall-opening'

/** Each shared agent tool's operation, by tool name: what every surface executes. */
export const AGENT_OPERATIONS = {
  list_levels: listLevels,
  get_node: getNode,
  get_level_summary: getLevelSummary,
  get_walls: getWalls,
  get_zones: getZones,
  duplicate_level: duplicateLevel,
  verify_scene: verifyScene,
  add_wall: addWall,
  add_level: addLevel,
  create_stair: createStair,
  place_items: placeItems,
  delete_node: deleteNode,
  find_by_type: findByType,
  create_room: createRoom,
  furnish_room: furnishRoom,
  search_assets: searchAssets,
  ...ROOM_OPERATIONS,
} as const

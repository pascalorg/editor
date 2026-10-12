import { addFence } from './add-fence'
import { addLevel } from './add-level'
import { addWall } from './add-wall'
import { addCornerWindow } from './corner-window'
import { createRoof } from './create-roof'
import { createRoom } from './create-room'
import { createStair } from './create-stair'
import { deleteNode } from './delete-node'
import { duplicateLevel } from './duplicate-level'
import { findByType } from './find-by-type'
import { furnishRoom } from './furnish-room'
import { getNode } from './get-node'
import { getLevelSummary, getWalls, getZones } from './level-reads'
import { listLevels } from './list-levels'
import { mergeWindowsOperation } from './merge-windows'
import { paint } from './paint'
import { placeItems } from './place-items'
import { ROOM_OPERATIONS } from './room-structure'
import { searchAssets } from './search-assets'
import { searchMaterials } from './search-materials'
import { fitStair, measureStairOperation } from './stairs'
import type { AgentOperations } from './types'
import { verifyScene } from './verify-scene'

export * from './achieved'
export * from './add-column'
export * from './add-fence'
export * from './add-level'
export * from './add-object'
export * from './add-wall'
export * from './apply-changes'
export * from './apply-outcome'
export * from './collections'
export * from './corner-window'
export * from './create-roof'
export * from './create-room'
export * from './create-stair'
export * from './delete-node'
export * from './door-clearance'
export * from './duplicate-level'
export * from './find-by-type'
export * from './furnish-room'
export * from './get-node'
export * from './hosted-services'
export * from './layout-clearance'
export * from './level-height-fill'
export * from './level-reads'
export * from './level-target'
export * from './list-levels'
export * from './material-preset'
export * from './material-refs'
export * from './merge-windows'
export * from './node-patch'
export * from './paint'
export * from './place-items'
export * from './plan-geometry'
export * from './room-structure'
export * from './scene-materials'
export * from './scene-measure'
export * from './scene-queries'
export * from './scene-view'
export * from './search-assets'
export * from './search-materials'
export * from './stairs'
export * from './types'
export * from './verify-scene'
export * from './wall-opening'

/** Each shared agent tool's operation, by tool name: what every surface executes. */
export const AGENT_OPERATIONS = {
  measure_stair: measureStairOperation,
  fit_stair: fitStair,
  list_levels: listLevels,
  get_node: getNode,
  get_level_summary: getLevelSummary,
  get_walls: getWalls,
  get_zones: getZones,
  duplicate_level: duplicateLevel,
  verify_scene: verifyScene,
  add_wall: addWall,
  add_fence: addFence,
  add_corner_window: addCornerWindow,
  merge_windows: mergeWindowsOperation,
  add_level: addLevel,
  create_stair: createStair,
  create_roof: createRoof,
  place_items: placeItems,
  delete_node: deleteNode,
  find_by_type: findByType,
  create_room: createRoom,
  furnish_room: furnishRoom,
  search_assets: searchAssets,
  paint,
  search_materials: searchMaterials,
  ...ROOM_OPERATIONS,
} as const satisfies AgentOperations

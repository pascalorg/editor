import { AGENT_TOOL_CONTRACTS, BATCHABLE_TOOLS } from '../agent-tools'
import { addColumn } from './add-column'
import { addFence } from './add-fence'
import { addLevel } from './add-level'
import { addWall } from './add-wall'
import { createBatchOperation } from './batch'
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
import { moveRoofsToRoofLevel } from './move-roofs'
import { paint } from './paint'
import { placeInRoom } from './place-in-room'
import { placeItems } from './place-items'
import { ROOM_OPERATIONS } from './room-structure'
import { searchAssets } from './search-assets'
import { searchMaterials } from './search-materials'
import { setCheckpoint } from './set-checkpoint'
import { getSite, placeBuilding } from './site'
import { fitStair, measureStairOperation } from './stairs'
import type { AgentOperation, AgentOperations } from './types'
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
export * from './move-roofs'
export * from './node-patch'
export * from './paint'
export * from './place-items'
export * from './plan-geometry'
export * from './point-context'
export * from './room-structure'
export * from './scene-materials'
export * from './scene-measure'
export * from './scene-queries'
export * from './scene-view'
export * from './search-assets'
export * from './search-materials'
export * from './site'
export * from './stairs'
export * from './types'
export * from './verify-scene'
export * from './wall-object-observations'
export * from './wall-opening'

const SINGLE_OPERATIONS = {
  measure_stair: measureStairOperation,
  fit_stair: fitStair,
  list_levels: listLevels,
  get_node: getNode,
  get_level_summary: getLevelSummary,
  get_walls: getWalls,
  get_zones: getZones,
  duplicate_level: duplicateLevel,
  verify_scene: verifyScene,
  set_checkpoint: setCheckpoint,
  add_wall: addWall,
  add_fence: addFence,
  add_corner_window: addCornerWindow,
  merge_windows: mergeWindowsOperation,
  add_level: addLevel,
  create_stair: createStair,
  add_column: addColumn,
  create_roof: createRoof,
  move_roofs_to_roof_level: moveRoofsToRoofLevel,
  place_items: placeItems,
  delete_node: deleteNode,
  find_by_type: findByType,
  create_room: createRoom,
  furnish_room: furnishRoom,
  paint,
  place_in_room: placeInRoom,
  search_assets: searchAssets,
  search_materials: searchMaterials,
  get_site: getSite,
  place_building: placeBuilding,
  ...ROOM_OPERATIONS,
} as const

const BATCHED_OPERATIONS = Object.fromEntries(
  BATCHABLE_TOOLS.map((name) => [name, SINGLE_OPERATIONS[name]]),
) as Record<(typeof BATCHABLE_TOOLS)[number], AgentOperation<never>>

/** Each shared agent tool's operation, by tool name: what every surface executes. */
export const AGENT_OPERATIONS = {
  ...SINGLE_OPERATIONS,
  run_batch: createBatchOperation(BATCHED_OPERATIONS, AGENT_TOOL_CONTRACTS),
} as const satisfies AgentOperations

export { type PhotoFacePlan, planPhotoElevation } from './photo-elevation'
export { recordMade } from './record-made'
export {
  EMPTY_SESSION,
  keepInSession,
  madeEntries,
  parseSessionRecord,
  type SessionKeep,
  type SessionRecord,
  startOfSession,
} from './scene-checkpoint'

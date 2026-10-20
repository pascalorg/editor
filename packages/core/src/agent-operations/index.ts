import { AGENT_TOOL_CONTRACTS, BATCHABLE_TOOLS } from '../agent-tools'
import { addColumn } from './add-column'
import { addFence } from './add-fence'
import { addLevel } from './add-level'
import { addObjectInBatch } from './add-object'
import { addWall } from './add-wall'
import { viewAssets } from './asset-views'
import { createBatchOperation } from './batch'
import { addCornerWindow } from './corner-window'
import { createRoof } from './create-roof'
import { createRoom } from './create-room'
import { createStair } from './create-stair'
import { deleteNode } from './delete-node'
import { designBrief, gatedByBrief } from './design-brief'
import { placeDesign, validateDesignOperation } from './designs'
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
export * from './author-scene'
export * from './authored-scene-merge'
export * from './collections'
export * from './corner-window'
export * from './create-roof'
export * from './create-room'
export * from './create-stair'
export * from './delete-node'
export * from './design-brief'
export * from './designs'
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
export * from './project-files'
export * from './roof-writes'
export * from './room-floor-script'
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
export * from './wall-face-script'
export * from './wall-object-observations'
export * from './wall-opening'
export * from './wall-skirting'

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
  validate_design: validateDesignOperation,
  place_design: gatedByBrief('place_design', placeDesign),
  set_checkpoint: setCheckpoint,
  design_brief: designBrief,
  add_wall: addWall,
  add_fence: addFence,
  add_corner_window: addCornerWindow,
  merge_windows: mergeWindowsOperation,
  add_level: addLevel,
  create_stair: createStair,
  add_column: addColumn,
  create_roof: createRoof,
  move_roofs_to_roof_level: moveRoofsToRoofLevel,
  place_items: gatedByBrief('place_items', placeItems),
  delete_node: deleteNode,
  find_by_type: findByType,
  create_room: createRoom,
  furnish_room: gatedByBrief('furnish_room', furnishRoom),
  paint,
  place_in_room: gatedByBrief('place_in_room', placeInRoom),
  search_assets: searchAssets,
  view_assets: viewAssets,
  search_materials: searchMaterials,
  get_site: getSite,
  place_building: placeBuilding,
  ...ROOM_OPERATIONS,
} as const

// add_object is no single operation: its host compiles the module first, so it exists here only as
// the batch's call, which places what the host built.
const BATCH_OPERATIONS = { ...SINGLE_OPERATIONS, add_object: addObjectInBatch }

const BATCHED_OPERATIONS = Object.fromEntries(
  BATCHABLE_TOOLS.map((name) => [name, BATCH_OPERATIONS[name]]),
) as Record<(typeof BATCHABLE_TOOLS)[number], AgentOperation<never>>

/** Each shared agent tool's operation, by tool name: what every surface executes. */
export const AGENT_OPERATIONS = {
  ...SINGLE_OPERATIONS,
  run_batch: createBatchOperation(BATCHED_OPERATIONS, AGENT_TOOL_CONTRACTS),
} as const satisfies AgentOperations

export {
  type AssetViewFacts,
  type AssetViewIO,
  type AssetViewLoader,
  type AssetViewSubject,
  assetViewNeeds,
  assetViewsReadCatalog,
  createAssetViewLoader,
  createFetchAssetViewIO,
  readGlbSurfaces,
} from './asset-views'
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

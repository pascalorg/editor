import { AGENT_TOOL_CONTRACTS, BATCHABLE_TOOLS } from '../agent-tools'
import { addColumn } from './add-column'
import { addLevel } from './add-level'
import { addWall } from './add-wall'
import { createBatchOperation } from './batch'
import { createStairsAndLifts } from './circulation'
import { addCornerWindow } from './corner-window'
import { createRoof } from './create-roof'
import { createRoom } from './create-room'
import { createStair } from './create-stair'
import { deleteNode } from './delete-node'
import { disputeCoherenceItem } from './dispute-coherence'
import { duplicateLevel } from './duplicate-level'
import { addEntryDoors } from './entry-doors'
import { describeBuildingFacade } from './facade-set-operation'
import { findByType } from './find-by-type'
import { furnishFromPlan } from './furnish-from-plan'
import { furnishRoom } from './furnish-room'
import { getNode } from './get-node'
import { getLevelSummary, getWalls, getZones } from './level-reads'
import { listLevels } from './list-levels'
import { mergeWindowsOperation } from './merge-windows'
import { nameUnits } from './name-units'
import { paint } from './paint'
import { locatePhoto } from './photo-location'
import { placeInRoom } from './place-in-room'
import { placeItems } from './place-items'
import { calibratePlanReference, getPlanReference, matchPlanReference } from './plan-calibration'
import { correctPlanReading } from './plan-reading'
import { surveyPlanReferences } from './plan-survey'
import { createReferenceElements } from './reference-elements'
import { recordReference } from './reference-items'
import { ROOM_OPERATIONS } from './room-structure'
import { searchAssets } from './search-assets'
import { searchMaterials } from './search-materials'
import { setCheckpoint } from './set-checkpoint'
import { addFence, addSiteSurface, addSteps } from './site-works'
import { fitStair, measureStairOperation } from './stairs'
import type { AgentOperation } from './types'
import { applyLayout, proposeLayouts } from './unit-layouts'
import { vectorizePlan } from './vectorize-plan'
import { verifyScene } from './verify-scene'

export * from './achieved'
export * from './add-column'
export * from './add-level'
export * from './add-object'
export * from './add-wall'
export * from './apply-changes'
export * from './apply-outcome'
export * from './collections'
export * from './corner-window'
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
export * from './place-items'
export * from './plan-geometry'
export * from './point-context'
export * from './room-structure'
export * from './scene-materials'
export * from './scene-measure'
export * from './scene-queries'
export * from './scene-view'
export * from './search-assets'
export * from './stairs'
export * from './types'
export * from './verify-scene'
export * from './wall-opening'

const SINGLE_OPERATIONS = {
  record_reference: recordReference,
  measure_stair: measureStairOperation,
  fit_stair: fitStair,
  list_levels: listLevels,
  get_node: getNode,
  get_level_summary: getLevelSummary,
  get_walls: getWalls,
  get_zones: getZones,
  duplicate_level: duplicateLevel,
  verify_scene: verifyScene,
  dispute_coherence_item: disputeCoherenceItem,
  set_checkpoint: setCheckpoint,
  add_wall: addWall,
  add_fence: addFence,
  add_corner_window: addCornerWindow,
  add_site_surface: addSiteSurface,
  add_steps: addSteps,
  merge_windows: mergeWindowsOperation,
  add_level: addLevel,
  create_stair: createStair,
  add_column: addColumn,
  create_roof: createRoof,
  place_items: placeItems,
  delete_node: deleteNode,
  find_by_type: findByType,
  create_room: createRoom,
  furnish_room: furnishRoom,
  furnish_from_plan: furnishFromPlan,
  vectorize_plan: vectorizePlan,
  paint,
  place_in_room: placeInRoom,
  search_assets: searchAssets,
  search_materials: searchMaterials,
  ...ROOM_OPERATIONS,
  get_plan_reference: getPlanReference,
  calibrate_plan_reference: calibratePlanReference,
  match_plan_reference: matchPlanReference,
  survey_plan_references: surveyPlanReferences,
  create_reference_elements: createReferenceElements,
  correct_plan_reading: correctPlanReading,
  create_stairs_and_lifts: createStairsAndLifts,
  add_entry_doors: addEntryDoors,
  describe_facade: describeBuildingFacade,
  locate_photo: locatePhoto,
  propose_unit_layouts: proposeLayouts,
  apply_unit_layout: applyLayout,
  name_units: nameUnits,
} as const

const BATCHED_OPERATIONS = Object.fromEntries(
  BATCHABLE_TOOLS.map((name) => [name, SINGLE_OPERATIONS[name]]),
) as Record<(typeof BATCHABLE_TOOLS)[number], AgentOperation<never>>

/** Each shared agent tool's operation, by tool name: what every surface executes. */
export const AGENT_OPERATIONS = {
  ...SINGLE_OPERATIONS,
  run_batch: createBatchOperation(BATCHED_OPERATIONS, AGENT_TOOL_CONTRACTS),
} as const

export { type PlanMask, planMask } from '../building/unit-layout-plan-score'
export { type UnitLayoutJudge } from '../building/unit-layout-propose'
export { facadeAppliedResult } from './facade-result'
export { facadeSetSummary, planAgentFacadeSet } from './facade-set-operation'
export {
  facadeRequests,
  facadeTargetsFor,
  requireBalconiesKept,
  requireFacadeFits,
  requireFacadePreviewed,
} from './facade-targets'
export { furnishFromPlanQuestions } from './furnish-from-plan'
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
export { proposeUnitLayoutsInScene } from './unit-layouts'
export { vectorizePlanTarget } from './vectorize-plan'

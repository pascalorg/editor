import { addObjectTool, getSourceTool } from './add-object'
import { searchAssetsTool } from './assets'
import { runBatchTool } from './batch'
import { setCheckpointTool } from './checkpoints'
import { createStairsAndLiftsTool } from './circulation'
import { clearSceneTool } from './clear-scene'
import { disputeCoherenceItemTool } from './coherence'
import { editCollectionTool, listCollectionsTool } from './collections'
import { addColumnTool } from './columns'
import { addCornerWindowTool } from './corner-window'
import { createRoomTool } from './create-room'
import { addEntryDoorsTool } from './entry-doors'
import {
  applyFacadeSetTool,
  applyFacadeTool,
  describeFacadeTool,
  previewFacadeUnitTool,
} from './facade'
import { findByTypeTool } from './find-by-type'
import { furnishFromPlanTool } from './furnish-from-plan'
import { furnishRoomTool } from './furnish-room'
import { plansGuide } from './guides'
import { recordReferenceTool } from './inventory'
import {
  addLevelTool,
  duplicateLevelTool,
  getLevelSummaryTool,
  getWallsTool,
  getZonesTool,
  listLevelsTool,
} from './levels'
import { mergeWindowsTool } from './merge-windows'
import { deleteNodeTool, getNodeTool } from './nodes'
import { paintTool } from './paint'
import { locatePhotoTool } from './photo-location'
import { placeInRoomTool } from './place-in-room'
import { placeItemsTool } from './place-items'
import {
  adjustPlanReferenceTool,
  alignReferenceFramesTool,
  calibratePlanReferenceTool,
  correctPlanReadingTool,
  createReferenceElementsTool,
  getPlanReferenceTool,
  importPlanReferenceTool,
  matchPlanReferenceTool,
  refinePlanMatchTool,
  surveyPlanReferencesTool,
} from './plan-reference'
import { createRoofTool } from './roofs'
import { ROOM_TOOL_CONTRACTS } from './room-structure'
import { searchMaterialsTool } from './search-materials'
import { addFenceTool, addSiteSurfaceTool, addStepsTool } from './site-works'
import { createStairTool, fitStairTool, measureStairTool } from './stairs'
import { applyUnitLayoutTool, proposeUnitLayoutsTool } from './unit-layouts'
import { nameUnitsTool } from './units'
import { vectorizePlanTool } from './vectorize-plan'
import { verifySceneTool } from './verify-scene'
import { viewSceneTool } from './view-scene'
import { addDoorTool, addWindowTool } from './wall-openings'
import { addWallTool } from './walls'

export * from './achieved'
export * from './add-object'
export * from './assets'
export * from './clear-scene'
export * from './collections'
export * from './columns'
export * from './corner-window'
export * from './create-room'
export * from './find-by-type'
export * from './furnish-room'
export * from './hosted-services'
export * from './levels'
export * from './measurement'
export * from './merge-windows'
export { NodeId } from './node-id'
export * from './nodes'
export * from './place-items'
export * from './refusal'
export * from './room-structure'
export * from './stairs'
export * from './verify-scene'
export * from './view-scene'
export * from './visual-references'
export * from './wall-openings'
export * from './walls'
export * from './write-target'

/**
 * Tools defined once for every agent surface — the MCP server and the hosted AI chat register
 * each from this contract (name, description, input schema), and a parity test fails when a
 * surface drifts. See wiki/architecture/agent-surfaces.md.
 */
export const AGENT_TOOL_CONTRACTS = [
  recordReferenceTool,
  addColumnTool,
  measureStairTool,
  fitStairTool,
  viewSceneTool,
  addDoorTool,
  addWindowTool,
  listLevelsTool,
  getNodeTool,
  getLevelSummaryTool,
  getWallsTool,
  getZonesTool,
  duplicateLevelTool,
  verifySceneTool,
  disputeCoherenceItemTool,
  setCheckpointTool,
  addWallTool,
  addFenceTool,
  addCornerWindowTool,
  addSiteSurfaceTool,
  addStepsTool,
  mergeWindowsTool,
  addLevelTool,
  placeItemsTool,
  createStairTool,
  createRoofTool,
  deleteNodeTool,
  addObjectTool,
  getSourceTool,
  findByTypeTool,
  editCollectionTool,
  listCollectionsTool,
  clearSceneTool,
  createRoomTool,
  furnishRoomTool,
  furnishFromPlanTool,
  vectorizePlanTool,
  paintTool,
  placeInRoomTool,
  searchAssetsTool,
  searchMaterialsTool,
  ...ROOM_TOOL_CONTRACTS,
  importPlanReferenceTool,
  adjustPlanReferenceTool,
  refinePlanMatchTool,
  alignReferenceFramesTool,
  createReferenceElementsTool,
  previewFacadeUnitTool,
  applyFacadeTool,
  applyFacadeSetTool,
  describeFacadeTool,
  getPlanReferenceTool,
  calibratePlanReferenceTool,
  matchPlanReferenceTool,
  surveyPlanReferencesTool,
  correctPlanReadingTool,
  createStairsAndLiftsTool,
  addEntryDoorsTool,
  locatePhotoTool,
  proposeUnitLayoutsTool,
  applyUnitLayoutTool,
  nameUnitsTool,
  runBatchTool,
] as const

export { BATCHABLE_TOOLS, runBatchTool } from './batch'
export { setCheckpointTool } from './checkpoints'
export { createStairsAndLiftsTool } from './circulation'
export { disputeCoherenceItemTool } from './coherence'
export { addEntryDoorsTool } from './entry-doors'
export {
  applyFacadeOutput,
  applyFacadeSetTool,
  applyFacadeTool,
  describeFacadeTool,
  facadePreviewOutput,
  previewFacadeUnitTool,
} from './facade'
export { furnishFromPlanTool } from './furnish-from-plan'
export { recordReferenceTool } from './inventory'
export { paintTool } from './paint'
export { straightenFacadePhotoTool } from './photo-elevation'
export { locatePhotoTool } from './photo-location'
export { placeInRoomTool } from './place-in-room'
export {
  adjustPlanReferenceTool,
  alignReferenceFramesTool,
  calibratePlanReferenceTool,
  correctPlanReadingTool,
  createReferenceElementsTool,
  getPlanReferenceTool,
  importPlanReferenceTool,
  matchPlanReferenceTool,
  refinePlanMatchTool,
  surveyPlanReferencesTool,
} from './plan-reference'
export { createRoofTool } from './roofs'
export { searchMaterialsTool } from './search-materials'
export { addFenceTool, addSiteSurfaceTool, addStepsTool } from './site-works'
export { applyUnitLayoutTool, proposeUnitLayoutsTool } from './unit-layouts'
export { nameUnitsTool } from './units'
export { VECTORIZE_PRICING, vectorizePlanTool } from './vectorize-plan'

export const BUILD_FROM_PLANS_GUIDE = plansGuide()
export { REFERENCE_INPUTS_GUIDE } from './guides'

import { addObjectTool, getSourceTool } from './add-object'
import { searchAssetsTool } from './assets'
import { runBatchTool } from './batch'
import { setCheckpointTool } from './checkpoints'
import { clearSceneTool } from './clear-scene'
import { editCollectionTool, listCollectionsTool } from './collections'
import { addColumnTool } from './columns'
import type { AgentToolContract } from './contract'
import { addCornerWindowTool } from './corner-window'
import { createRoomTool } from './create-room'
import { addFenceTool } from './fences'
import { findByTypeTool } from './find-by-type'
import { furnishRoomTool } from './furnish-room'
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
import { placeInRoomTool } from './place-in-room'
import { placeItemsTool } from './place-items'
import { createRoofTool, moveRoofsToRoofLevelTool } from './roofs'
import { ROOM_TOOL_CONTRACTS } from './room-structure'
import { searchMaterialsTool } from './search-materials'
import { getSiteTool, placeBuildingTool } from './site'
import { createStairTool, fitStairTool, measureStairTool } from './stairs'
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
export * from './contract'
export * from './corner-window'
export * from './create-room'
export * from './fences'
export * from './find-by-type'
export * from './furnish-room'
export * from './hosted-services'
export * from './levels'
export * from './measurement'
export * from './merge-windows'
export { NodeId } from './node-id'
export * from './nodes'
export * from './paint'
export * from './place-items'
export * from './refusal'
export * from './roofs'
export * from './room-structure'
export * from './search-materials'
export * from './site'
export * from './stairs'
export * from './verify-scene'
export * from './view-scene'
export * from './wall-openings'
export * from './walls'
export * from './write-target'

/**
 * Tools defined once for every agent surface — the MCP server and the hosted AI chat register
 * each from this contract (name, description, input schema), and a parity test fails when a
 * surface drifts. See wiki/architecture/agent-surfaces.md.
 */
export const AGENT_TOOL_CONTRACTS = [
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
  setCheckpointTool,
  addWallTool,
  addFenceTool,
  addCornerWindowTool,
  mergeWindowsTool,
  addLevelTool,
  placeItemsTool,
  createStairTool,
  createRoofTool,
  moveRoofsToRoofLevelTool,
  deleteNodeTool,
  addObjectTool,
  getSourceTool,
  findByTypeTool,
  editCollectionTool,
  listCollectionsTool,
  clearSceneTool,
  createRoomTool,
  furnishRoomTool,
  paintTool,
  placeInRoomTool,
  searchAssetsTool,
  searchMaterialsTool,
  getSiteTool,
  placeBuildingTool,
  ...ROOM_TOOL_CONTRACTS,
  runBatchTool,
] as const satisfies readonly AgentToolContract[]

export { BATCHABLE_TOOLS, runBatchTool } from './batch'
export { setCheckpointTool } from './checkpoints'
export { straightenFacadePhotoTool } from './photo-elevation'
export { placeInRoomTool } from './place-in-room'
export { createRoofTool } from './roofs'

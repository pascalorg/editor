import { addObjectTool, getSourceTool } from './add-object'
import { searchAssetsTool } from './assets'
import { editCollectionTool, listCollectionsTool } from './collections'
import { addColumnTool } from './columns'
import { createRoomTool } from './create-room'
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
import { deleteNodeTool, getNodeTool } from './nodes'
import { placeItemsTool } from './place-items'
import { ROOM_TOOL_CONTRACTS } from './room-structure'
import { createStairTool } from './stairs'
import { verifySceneTool } from './verify-scene'
import { addDoorTool, addWindowTool } from './wall-openings'
import { addWallTool } from './walls'

export * from './achieved'
export * from './add-object'
export * from './assets'
export * from './collections'
export * from './columns'
export * from './create-room'
export * from './find-by-type'
export * from './furnish-room'
export * from './levels'
export * from './measurement'
export { NodeId } from './node-id'
export * from './nodes'
export * from './place-items'
export * from './refusal'
export * from './room-structure'
export * from './stairs'
export * from './verify-scene'
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
  addDoorTool,
  addWindowTool,
  listLevelsTool,
  getNodeTool,
  getLevelSummaryTool,
  getWallsTool,
  getZonesTool,
  duplicateLevelTool,
  verifySceneTool,
  addWallTool,
  addLevelTool,
  placeItemsTool,
  createStairTool,
  deleteNodeTool,
  addObjectTool,
  getSourceTool,
  findByTypeTool,
  editCollectionTool,
  listCollectionsTool,
  createRoomTool,
  furnishRoomTool,
  searchAssetsTool,
  ...ROOM_TOOL_CONTRACTS,
] as const

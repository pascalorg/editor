import { addObjectTool, getSourceTool } from './add-object'
import { findByTypeTool } from './find-by-type'
import {
  duplicateLevelTool,
  getLevelSummaryTool,
  getWallsTool,
  getZonesTool,
  listLevelsTool,
  verifySceneTool,
} from './levels'
import { deleteNodeTool, getNodeTool } from './nodes'
import { addDoorTool, addWindowTool } from './wall-openings'

export * from './add-object'
export * from './find-by-type'
export * from './hosted-services'
export * from './levels'
export * from './measurement'
export { NodeId } from './node-id'
export * from './nodes'
export * from './refusal'
export * from './wall-openings'

/**
 * Tools defined once for every agent surface — the MCP server and the hosted AI chat register
 * each from this contract (name, description, input schema), and a parity test fails when a
 * surface drifts. See wiki/architecture/agent-surfaces.md.
 */
export const AGENT_TOOL_CONTRACTS = [
  addDoorTool,
  addWindowTool,
  listLevelsTool,
  getNodeTool,
  getLevelSummaryTool,
  getWallsTool,
  getZonesTool,
  duplicateLevelTool,
  verifySceneTool,
  deleteNodeTool,
  addObjectTool,
  getSourceTool,
  findByTypeTool,
] as const

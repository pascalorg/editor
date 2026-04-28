import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { SceneOperations } from '../operations'
import { registerFromBrief } from './from-brief'
import { registerIterateOnFeedback } from './iterate-on-feedback'
import { registerRenovationFromPhotos } from './renovation-from-photos'

/**
 * Registers all MCP prompts exposed by `@pascal-app/mcp`:
 * - `from_brief`                — generate a scene from a natural-language brief
 * - `iterate_on_feedback`       — minimal-diff patches from user feedback
 * - `renovation_from_photos`    — photo-driven renovation plan via vision tools
 */
export function registerPrompts(server: McpServer, operations: SceneOperations): void {
  registerFromBrief(server, operations)
  registerIterateOnFeedback(server, operations)
  registerRenovationFromPhotos(server, operations)
}

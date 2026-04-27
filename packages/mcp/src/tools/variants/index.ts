import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { SceneOperations } from '../../operations'
import { registerGenerateVariants } from './generate-variants'

/**
 * Register the variant-generation MCP tools against shared scene operations.
 */
export function registerVariantTools(server: McpServer, bridge: SceneOperations): void {
  registerGenerateVariants(server, bridge)
}

export {
  generateVariantsInput,
  generateVariantsOutput,
  registerGenerateVariants,
} from './generate-variants'
export {
  applyMutation,
  describeVariant,
  type MutationKind,
  mulberry32,
  type Rng,
} from './mutations'

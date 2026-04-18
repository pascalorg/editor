import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { SceneBridge } from '../../bridge/scene-bridge'
import type { SceneStore } from '../../storage/types'
import { registerGenerateVariants } from './generate-variants'

/**
 * Register the variant-generation MCP tools against the given server. Uses the
 * supplied `SceneStore` both to load a `baseSceneId` (when provided) and to
 * persist variants when `save=true`.
 */
export function registerVariantTools(
  server: McpServer,
  bridge: SceneBridge,
  store: SceneStore,
): void {
  registerGenerateVariants(server, bridge, store)
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

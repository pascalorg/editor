import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { describeDesignSchema } from '@pascal-app/core/procedural-items'
import type { SceneOperations } from '../operations'

/**
 * `pascal://schema/design` — the design (procedural recipe, versions 1 and 2) contract: JSON Schema generated
 * from core's `RecipeSchema`, the limits and rules only `validate_design` can check, and one
 * valid example.
 */
export function registerDesignSchema(server: McpServer, _bridge: SceneOperations): void {
  server.registerResource(
    'design-schema',
    'pascal://schema/design',
    {
      title: 'Design schema',
      description:
        'JSON Schema, limits, rules and an example for Pascal designs (procedural items). Author a design against it, then call validate_design, which is the authority.',
      mimeType: 'application/json',
    },
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: 'application/json',
          text: JSON.stringify(describeDesignSchema()),
        },
      ],
    }),
  )
}

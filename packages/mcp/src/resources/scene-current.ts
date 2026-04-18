import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { SceneBridge } from '../bridge/scene-bridge'

/**
 * `pascal://scene/current` — full `{ nodes, rootNodeIds, collections }` snapshot.
 *
 * Static URI (not a template). MIME `application/json`.
 */
export function registerSceneCurrent(server: McpServer, bridge: SceneBridge): void {
  server.registerResource(
    'scene-current',
    'pascal://scene/current',
    {
      title: 'Current scene',
      description:
        'Complete snapshot of the live Pascal scene: nodes dict, rootNodeIds, collections.',
      mimeType: 'application/json',
    },
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: 'application/json',
          text: JSON.stringify(bridge.exportJSON()),
        },
      ],
    }),
  )
}

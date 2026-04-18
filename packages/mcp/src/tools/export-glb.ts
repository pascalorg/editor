import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import type { SceneBridge } from '../bridge/scene-bridge'

export const exportGlbInput = {}

export const exportGlbOutput = {
  status: z.literal('not_implemented'),
  reason: z.string(),
}

export function registerExportGlb(server: McpServer, _bridge: SceneBridge): void {
  server.registerTool(
    'export_glb',
    {
      title: 'Export GLB',
      description:
        'GLB export is not available in headless mode — it requires the Three.js renderer, which is browser-only. Returns a structured `not_implemented` response.',
      inputSchema: exportGlbInput,
      outputSchema: exportGlbOutput,
    },
    async () => {
      const payload = {
        status: 'not_implemented' as const,
        reason: 'GLB export requires the Three.js renderer, which is browser-only',
      }
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(payload) }],
        structuredContent: payload,
        isError: false,
      }
    },
  )
}

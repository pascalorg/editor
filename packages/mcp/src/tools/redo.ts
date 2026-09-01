import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import type { SceneOperations } from '../operations'
import { liveSyncOutput, persistencePayload, publishLiveSceneSnapshot } from './live-sync'

export const redoInput = {
  steps: z.number().int().positive().optional(),
}

export const redoOutput = {
  redone: z.number(),
  ...liveSyncOutput,
}

export function registerRedo(server: McpServer, bridge: SceneOperations): void {
  server.registerTool(
    'redo',
    {
      title: 'Redo',
      description:
        'Redo the next N previously-undone steps (default 1). Returns the number of steps actually redone.',
      inputSchema: redoInput,
      outputSchema: redoOutput,
    },
    async ({ steps }) => {
      const redone = bridge.redo(steps ?? 1)
      const persistence =
        redone > 0 ? await publishLiveSceneSnapshot(bridge, 'redo') : ('published' as const)
      const payload = { redone, ...persistencePayload(persistence) }
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(payload) }],
        structuredContent: payload,
      }
    },
  )
}

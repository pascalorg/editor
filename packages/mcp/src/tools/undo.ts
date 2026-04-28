import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import type { SceneOperations } from '../operations'
import { publishLiveSceneSnapshot } from './live-sync'

export const undoInput = {
  steps: z.number().int().positive().optional(),
}

export const undoOutput = {
  undone: z.number(),
}

export function registerUndo(server: McpServer, bridge: SceneOperations): void {
  server.registerTool(
    'undo',
    {
      title: 'Undo',
      description:
        'Undo the most recent N steps in the scene history (default 1). Returns the number of steps actually undone.',
      inputSchema: undoInput,
      outputSchema: undoOutput,
    },
    async ({ steps }) => {
      const undone = bridge.undo(steps ?? 1)
      if (undone > 0) await publishLiveSceneSnapshot(bridge, 'undo')
      const payload = { undone }
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(payload) }],
        structuredContent: payload,
      }
    },
  )
}

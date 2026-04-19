import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { AnyNodeId } from '@pascal-app/core/schema'
import { DoorNode, WindowNode } from '@pascal-app/core/schema'
import { z } from 'zod'
import type { SceneBridge } from '../bridge/scene-bridge'
import { ErrorCode, throwMcpError } from './errors'
import { NodeIdSchema } from './schemas'

export const cutOpeningInput = {
  wallId: NodeIdSchema,
  type: z.enum(['door', 'window']),
  position: z.number().min(0).max(1),
  width: z.number().positive(),
  height: z.number().positive(),
}

export const cutOpeningOutput = {
  openingId: z.string(),
}

export function registerCutOpening(server: McpServer, bridge: SceneBridge): void {
  server.registerTool(
    'cut_opening',
    {
      title: 'Cut opening',
      description:
        'Cut a door or window opening into an existing wall. position is a parametric 0..1 offset along the wall centreline.',
      inputSchema: cutOpeningInput,
      outputSchema: cutOpeningOutput,
    },
    async ({ wallId, type, position, width, height }) => {
      const wall = bridge.getNode(wallId as AnyNodeId)
      if (!wall) {
        throwMcpError(ErrorCode.InvalidParams, `Wall not found: ${wallId}`)
      }
      if (wall.type !== 'wall') {
        throwMcpError(ErrorCode.InvalidParams, `Node ${wallId} is a ${wall.type}, expected wall`)
      }

      // wallT is stored on door/window children via position in the schema;
      // the core systems look up wallId and derive placement from `position[0]`
      // being on the wall-local axis. We set wallId explicitly so the runtime
      // can associate the opening with its parent wall.
      const base = {
        wallId,
        width,
        height,
        position: [position, height / 2, 0] as [number, number, number],
      }

      const opening = type === 'door' ? DoorNode.parse(base) : WindowNode.parse(base)
      const id = bridge.createNode(opening, wallId as AnyNodeId)

      const payload = { openingId: id as string }
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(payload) }],
        structuredContent: payload,
      }
    },
  )
}

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { AnyNodeId } from '@pascal-app/core/schema'
import { DoorNode, WindowNode } from '@pascal-app/core/schema'
import { z } from 'zod'
import type { SceneBridge } from '../bridge/scene-bridge'
import type { SceneStore } from '../storage/types'
import { ErrorCode, throwMcpError } from './errors'
import { wallLength, wallLocalXFromT } from './geometry'
import { publishLiveSceneSnapshot } from './live-sync'
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

export function registerCutOpening(
  server: McpServer,
  bridge: SceneBridge,
  store?: SceneStore,
): void {
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

      const length = wallLength(wall)
      if (length < width) {
        throwMcpError(
          ErrorCode.InvalidParams,
          `Wall ${wallId} is ${length.toFixed(2)}m long, too short for a ${width.toFixed(2)}m opening`,
        )
      }

      // `position` is public MCP ergonomics: 0..1 along the wall. Door/window
      // nodes store wall-local meters in position[0], so convert before writing.
      const base = {
        wallId,
        width,
        height,
        position: [wallLocalXFromT(wall, position, width), height / 2, 0] as [
          number,
          number,
          number,
        ],
      }

      const opening =
        type === 'door'
          ? DoorNode.parse(base)
          : WindowNode.parse({
              ...base,
              position: [base.position[0], 0.9 + height / 2, 0],
            })
      const id = bridge.createNode(opening, wallId as AnyNodeId)
      await publishLiveSceneSnapshot(bridge, store, 'cut_opening')

      const payload = { openingId: id as string }
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(payload) }],
        structuredContent: payload,
      }
    },
  )
}

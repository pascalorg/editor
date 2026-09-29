import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { getOpeningFloorDatum, isFloorAnchoredOpening } from '@pascal-app/core'
import type { AnyNodeId } from '@pascal-app/core/schema'
import { z } from 'zod'
import type { SceneOperations } from '../operations'
import { READ_ONLY_TOOL_ANNOTATIONS } from './annotations'
import { ErrorCode, throwMcpError } from './errors'
import { NodeIdSchema } from './schemas'

export const getNodeInput = {
  id: NodeIdSchema,
}

export const getNodeOutput = {
  node: z.record(z.string(), z.unknown()),
}

export function registerGetNode(server: McpServer, bridge: SceneOperations): void {
  server.registerTool(
    'get_node',
    {
      title: 'Get node',
      description: 'Return the full node payload for the given ID.',
      inputSchema: getNodeInput,
      outputSchema: getNodeOutput,
      annotations: READ_ONLY_TOOL_ANNOTATIONS,
    },
    async ({ id }) => {
      const node = bridge.getNode(id as AnyNodeId)
      if (!node) {
        throwMcpError(ErrorCode.InvalidParams, `Node not found: ${id}`)
      }
      const wall = node.parentId ? bridge.getNode(node.parentId as AnyNodeId) : undefined
      const opening =
        (node.type === 'door' || node.type === 'window') && wall?.type === 'wall'
          ? {
              floorDatum: getOpeningFloorDatum(wall, node, bridge.getNodes()),
              anchor: isFloorAnchoredOpening(node) ? 'floor' : 'wall',
            }
          : undefined
      const payload = {
        node: { ...node, ...(opening ? { resolvedOpening: opening } : {}) } as unknown as Record<
          string,
          unknown
        >,
      }
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(payload) }],
        structuredContent: payload,
      }
    },
  )
}

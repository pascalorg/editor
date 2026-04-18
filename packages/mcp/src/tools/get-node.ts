import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { AnyNodeId } from '@pascal-app/core/schema'
import { z } from 'zod'
import type { SceneBridge } from '../bridge/scene-bridge'
import { ErrorCode, throwMcpError } from './errors'
import { NodeIdSchema } from './schemas'

export const getNodeInput = {
  id: NodeIdSchema,
}

export const getNodeOutput = {
  node: z.record(z.string(), z.unknown()),
}

export function registerGetNode(server: McpServer, bridge: SceneBridge): void {
  server.registerTool(
    'get_node',
    {
      title: 'Get node',
      description: 'Return the full node payload for the given ID.',
      inputSchema: getNodeInput,
      outputSchema: getNodeOutput,
    },
    async ({ id }) => {
      const node = bridge.getNode(id as AnyNodeId)
      if (!node) {
        throwMcpError(ErrorCode.InvalidParams, `Node not found: ${id}`)
      }
      const payload = { node: node as unknown as Record<string, unknown> }
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(payload) }],
        structuredContent: payload,
      }
    },
  )
}

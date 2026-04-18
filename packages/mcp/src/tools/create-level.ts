import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { AnyNodeId } from '@pascal-app/core/schema'
import { LevelNode } from '@pascal-app/core/schema'
import { z } from 'zod'
import type { SceneBridge } from '../bridge/scene-bridge'
import { ErrorCode, throwMcpError } from './errors'
import { NodeIdSchema } from './schemas'

export const createLevelInput = {
  buildingId: NodeIdSchema,
  elevation: z.number().optional(),
  height: z.number().optional(),
  label: z.string().optional(),
}

export const createLevelOutput = {
  levelId: z.string(),
}

export function registerCreateLevel(server: McpServer, bridge: SceneBridge): void {
  server.registerTool(
    'create_level',
    {
      title: 'Create level',
      description:
        'Create a new level node attached to the given building. height and label are stored in metadata.',
      inputSchema: createLevelInput,
      outputSchema: createLevelOutput,
    },
    async ({ buildingId, elevation, height, label }) => {
      const parent = bridge.getNode(buildingId as AnyNodeId)
      if (!parent) {
        throwMcpError(ErrorCode.InvalidParams, `Building not found: ${buildingId}`)
      }
      if (parent.type !== 'building') {
        throwMcpError(
          ErrorCode.InvalidParams,
          `Node ${buildingId} is a ${parent.type}, expected building`,
        )
      }

      const metadata: Record<string, unknown> = {}
      if (height !== undefined) metadata.height = height
      if (label !== undefined) metadata.label = label

      const levelNode = LevelNode.parse({
        level: elevation ?? 0,
        children: [],
        ...(Object.keys(metadata).length > 0 ? { metadata } : {}),
        ...(label !== undefined ? { name: label } : {}),
      })

      const id = bridge.createNode(levelNode, buildingId as AnyNodeId)
      const payload = { levelId: id as string }
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(payload) }],
        structuredContent: payload,
      }
    },
  )
}

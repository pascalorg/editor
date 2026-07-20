import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { DEFAULT_LEVEL_HEIGHT } from '@pascal-app/core'
import type { AnyNodeId } from '@pascal-app/core/schema'
import { LevelNode } from '@pascal-app/core/schema'
import { z } from 'zod'
import type { SceneOperations } from '../operations'
import { ErrorCode, throwMcpError } from './errors'
import { publishLiveSceneSnapshot } from './live-sync'
import { measurement } from './measurement'
import { NodeIdSchema } from './schemas'

export const createLevelInput = {
  buildingId: NodeIdSchema,
  elevation: z
    .number()
    .optional()
    .describe("Legacy parameter; new levels are appended above the building's current top level."),
  height: measurement('length', 'm', {
    min: 0,
    description: 'Stored floor-to-floor storey height.',
  }).optional(),
  label: z.string().optional(),
}

export const createLevelOutput = {
  levelId: z.string(),
}

export function registerCreateLevel(server: McpServer, bridge: SceneOperations): void {
  server.registerTool(
    'create_level',
    {
      title: 'Create level',
      description:
        "Append a new level above the given building's current top level. height is stored as the level's floor-to-floor storey height.",
      inputSchema: createLevelInput,
      outputSchema: createLevelOutput,
    },
    async ({ buildingId, height, label }) => {
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
      if (label !== undefined) metadata.label = label
      const existingOrdinals = bridge
        .getChildren(buildingId as AnyNodeId)
        .filter((node) => node.type === 'level')
        .map((node) => node.level)
      const nextOrdinal = Math.max(-1, ...existingOrdinals) + 1

      const levelNode = LevelNode.parse({
        level: nextOrdinal,
        height: height ?? DEFAULT_LEVEL_HEIGHT,
        children: [],
        ...(Object.keys(metadata).length > 0 ? { metadata } : {}),
        ...(label !== undefined ? { name: label } : {}),
      })

      const id = bridge.createNode(levelNode, buildingId as AnyNodeId)
      await publishLiveSceneSnapshot(bridge, 'create_level')
      const payload = { levelId: id as string }
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(payload) }],
        structuredContent: payload,
      }
    },
  )
}

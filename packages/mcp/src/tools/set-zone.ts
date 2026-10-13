import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { newZone, walledRoomToName } from '@pascal-app/core'
import type { AnyNodeId } from '@pascal-app/core/schema'
import { z } from 'zod'
import type { SceneOperations } from '../operations'
import { ADDITIVE_TOOL_ANNOTATIONS } from './annotations'
import { ErrorCode, throwMcpError } from './errors'
import { liveSyncOutput, persistencePayload, publishLiveSceneSnapshot } from './live-sync'
import { NodeIdSchema, Vec2Schema } from './schemas'

export const setZoneInput = {
  levelId: NodeIdSchema,
  polygon: z.array(Vec2Schema).min(3),
  label: z.string().min(1),
  properties: z.record(z.string(), z.unknown()).optional(),
}

export const setZoneOutput = {
  zoneId: z.string(),
  ...liveSyncOutput,
}

export function registerSetZone(server: McpServer, bridge: SceneOperations): void {
  server.registerTool(
    'set_zone',
    {
      title: 'Set zone',
      description:
        'Create a polygonal zone on the given level. label is stored as the zone name and properties are merged into metadata. A polygon along walls that already enclose a room still named "Room N" names that room instead of adding a zone.',
      inputSchema: setZoneInput,
      outputSchema: setZoneOutput,
      annotations: ADDITIVE_TOOL_ANNOTATIONS,
    },
    async ({ levelId, polygon, label, properties }) => {
      const parent = bridge.getNode(levelId as AnyNodeId)
      if (!parent) {
        throwMcpError(ErrorCode.InvalidParams, `Level not found: ${levelId}`)
      }
      if (parent.type !== 'level') {
        throwMcpError(
          ErrorCode.InvalidParams,
          `Node ${levelId} is a ${parent.type}, expected level`,
        )
      }
      if (
        typeof parent.metadata === 'object' &&
        parent.metadata !== null &&
        'role' in parent.metadata &&
        parent.metadata.role === 'roof'
      ) {
        throwMcpError(
          ErrorCode.InvalidParams,
          `Roof support level ${levelId} is not an occupied story; create zones on an occupied level instead`,
        )
      }

      const walled = walledRoomToName(
        bridge.getNodes(),
        levelId,
        polygon as Array<[number, number]>,
      )
      let id: AnyNodeId
      if (walled) {
        id = walled.id
        bridge.updateNode(id, {
          name: label,
          metadata: { ...(walled.metadata as Record<string, unknown>), ...properties },
        })
      } else {
        const zone = newZone({
          name: label,
          polygon: polygon as Array<[number, number]>,
          metadata: properties ?? {},
        })
        id = bridge.createNode(zone, levelId as AnyNodeId)
      }
      const persistence = await publishLiveSceneSnapshot(bridge, 'set_zone')

      const payload = { zoneId: id as string, ...persistencePayload(persistence) }
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(payload) }],
        structuredContent: payload,
      }
    },
  )
}

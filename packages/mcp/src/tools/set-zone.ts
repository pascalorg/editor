import type { McpServer } from '@modelcontextprotocol/server'
import { isAllocatedRoomName, newZone, walledRoomAt } from '@pascal-app/core'
import { roofLevelRefusal } from '@pascal-app/core/agent-operations'
import type { AnyNodeId } from '@pascal-app/core/schema'
import { z } from 'zod'
import type { SceneOperations } from '../operations'
import { ADDITIVE_TOOL_ANNOTATIONS } from './annotations'
import { ProtocolErrorCode, refusalResult, throwMcpError } from './errors'
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
        'Create a polygonal zone on the given level. label is stored as the zone name and properties are merged into metadata. A polygon along walls that already enclose a room is that room, never a second zone: a room still named "Room N", or already named label, takes the label and properties; a room a person named otherwise is refused (rename it with update_node only when the person asked).',
      inputSchema: z.object(setZoneInput),
      outputSchema: z.object(setZoneOutput),
      annotations: ADDITIVE_TOOL_ANNOTATIONS,
    },
    async ({ levelId, polygon, label, properties }) => {
      const parent = bridge.getNode(levelId as AnyNodeId)
      if (!parent) {
        throwMcpError(ProtocolErrorCode.InvalidParams, `Level not found: ${levelId}`)
      }
      if (parent.type !== 'level') {
        throwMcpError(
          ProtocolErrorCode.InvalidParams,
          `Node ${levelId} is a ${parent.type}, expected level`,
        )
      }
      const onRoofLevel = roofLevelRefusal(bridge.getNodes(), levelId, 'a zone')
      if (onRoofLevel) return refusalResult(onRoofLevel)

      const walled = walledRoomAt(bridge.getNodes(), levelId, polygon as Array<[number, number]>)
      if (walled && !isAllocatedRoomName(walled.name) && walled.name !== label) {
        throwMcpError(
          ProtocolErrorCode.InvalidParams,
          `The walls here already enclose the room "${walled.name}" (${walled.id}), which a person named; a zone "${label}" would stack a second room on it. Rename it with update_node only if the person asked; otherwise leave it.`,
        )
      }
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

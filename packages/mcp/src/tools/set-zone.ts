import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { isAllocatedRoomName, isRoofLevel, newZone, walledRoomAt } from '@pascal-app/core'
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
        'Create a polygonal zone on the given level. label is stored as the zone name and properties are merged into metadata. A polygon along walls that already enclose a room is that room, never a second zone: a room still named "Room N", or already named label, takes the label and properties; a room a person named otherwise is refused (rename it with update_node only when the person asked).',
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
      if (isRoofLevel(parent)) {
        throwMcpError(
          ErrorCode.InvalidParams,
          `Roof support level ${levelId} is not an occupied story; create zones on an occupied level instead`,
        )
      }

      const walled = walledRoomAt(bridge.getNodes(), levelId, polygon as Array<[number, number]>)
      if (walled && !isAllocatedRoomName(walled.name) && walled.name !== label) {
        throwMcpError(
          ErrorCode.InvalidParams,
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

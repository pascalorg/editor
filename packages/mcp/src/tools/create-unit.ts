import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { AnyNodeId } from '@pascal-app/core/schema'
import { UnitNode } from '@pascal-app/core/schema'
import { z } from 'zod'
import type { SceneOperations } from '../operations'
import { ADDITIVE_TOOL_ANNOTATIONS } from './annotations'
import { liveSyncOutput, persistencePayload, publishLiveSceneSnapshot } from './live-sync'
import { NodeIdSchema } from './schemas'
import { validateUnitMembers } from './unit-members'

export const createUnitInput = {
  buildingId: NodeIdSchema,
  name: z.string(),
  kind: UnitNode.shape.kind.optional(),
  color: z.string().optional(),
  memberZoneIds: z.array(NodeIdSchema).optional(),
}

export const createUnitOutput = {
  unitId: z.string(),
  ...liveSyncOutput,
}

export function registerCreateUnit(server: McpServer, bridge: SceneOperations): void {
  server.registerTool(
    'create_unit',
    {
      title: 'Create unit',
      description:
        'Create a named unit in a building, optionally referencing zones across its levels.',
      inputSchema: createUnitInput,
      outputSchema: createUnitOutput,
      annotations: ADDITIVE_TOOL_ANNOTATIONS,
    },
    async ({ buildingId, name, kind, color, memberZoneIds }) => {
      const members = validateUnitMembers(bridge, buildingId, memberZoneIds ?? [])
      const unit = UnitNode.parse({ name, kind, color, members })
      const id = bridge.createNode(unit, buildingId as AnyNodeId)
      const persistence = await publishLiveSceneSnapshot(bridge, 'create_unit')
      const payload = { unitId: id as string, ...persistencePayload(persistence) }
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(payload) }],
        structuredContent: payload,
      }
    },
  )
}

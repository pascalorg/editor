import type { McpServer } from '@modelcontextprotocol/server'
import type { AnyNodeId } from '@pascal-app/core/schema'
import { z } from 'zod'
import type { SceneOperations } from '../operations'
import { DESTRUCTIVE_TOOL_ANNOTATIONS } from './annotations'
import { ProtocolErrorCode, throwMcpError } from './errors'
import { liveSyncOutput, persistencePayload, publishLiveSceneSnapshot } from './live-sync'
import { NodeIdSchema } from './schemas'
import { validateUnitMembers } from './unit-members'

export const setUnitMembersInput = {
  unitId: NodeIdSchema,
  memberZoneIds: z.array(NodeIdSchema),
}

export const setUnitMembersOutput = {
  unitId: z.string(),
  memberCount: z.number(),
  ...liveSyncOutput,
}

export function registerSetUnitMembers(server: McpServer, bridge: SceneOperations): void {
  server.registerTool(
    'set_unit_members',
    {
      title: 'Set unit members',
      description:
        'Replace the zones referenced by a unit. Every zone must belong to a level in the same building.',
      inputSchema: z.object(setUnitMembersInput),
      outputSchema: z.object(setUnitMembersOutput),
      annotations: { ...DESTRUCTIVE_TOOL_ANNOTATIONS, idempotentHint: true },
    },
    async ({ unitId, memberZoneIds }) => {
      const unit = bridge.getNode(unitId as AnyNodeId)
      if (!unit) {
        throwMcpError(ProtocolErrorCode.InvalidParams, `Unit not found: ${unitId}`)
      }
      if (unit.type !== 'unit') {
        throwMcpError(
          ProtocolErrorCode.InvalidParams,
          `Node ${unitId} is a ${unit.type}, expected unit`,
        )
      }
      if (!unit.parentId) {
        throwMcpError(ProtocolErrorCode.InvalidParams, `Unit ${unitId} must belong to a building`)
      }
      const members = validateUnitMembers(bridge, unit.parentId, memberZoneIds)
      bridge.updateNode(unit.id, { members })
      const persistence = await publishLiveSceneSnapshot(bridge, 'set_unit_members')
      const payload = { unitId, memberCount: members.length, ...persistencePayload(persistence) }
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(payload) }],
        structuredContent: payload,
      }
    },
  )
}

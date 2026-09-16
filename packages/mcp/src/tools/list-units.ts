import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { buildUnitReport } from '@pascal-app/core'
import { UnitNode } from '@pascal-app/core/schema'
import { z } from 'zod'
import type { SceneOperations } from '../operations'
import { READ_ONLY_TOOL_ANNOTATIONS } from './annotations'
import { NodeIdSchema } from './schemas'
import { validateUnitMembers } from './unit-members'

export const listUnitsInput = {
  buildingId: NodeIdSchema.optional(),
}

export const listUnitsOutput = {
  units: z.array(
    z.object({
      unitId: z.string(),
      name: z.string(),
      kind: UnitNode.shape.kind,
      color: z.string(),
      members: z.array(z.string()),
      report: z.object({
        memberCount: z.number(),
        levelSpan: z
          .object({ minOrdinal: z.number(), maxOrdinal: z.number(), count: z.number() })
          .nullable(),
        grossAreaM2: z.number(),
        members: z.array(
          z.object({
            zoneId: z.string(),
            name: z.string(),
            levelId: z.string().nullable(),
            levelOrdinal: z.number().nullable(),
            areaM2: z.number(),
          }),
        ),
      }),
    }),
  ),
}

export function registerListUnits(server: McpServer, bridge: SceneOperations): void {
  server.registerTool(
    'list_units',
    {
      title: 'List units',
      description:
        'List units with their member zones and current area reports, optionally filtered by building.',
      inputSchema: listUnitsInput,
      outputSchema: listUnitsOutput,
      annotations: READ_ONLY_TOOL_ANNOTATIONS,
    },
    async ({ buildingId }) => {
      if (buildingId !== undefined) validateUnitMembers(bridge, buildingId, [])
      const nodes = bridge.getNodes()
      const units = Object.values(nodes)
        .filter((node) => node.type === 'unit')
        .filter((unit) => buildingId === undefined || unit.parentId === buildingId)
        .map((unit) => ({
          unitId: unit.id,
          name: unit.name,
          kind: unit.kind,
          color: unit.color,
          members: unit.members,
          report: buildUnitReport(unit, nodes),
        }))
      const payload = { units }
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(payload) }],
        structuredContent: payload,
      }
    },
  )
}

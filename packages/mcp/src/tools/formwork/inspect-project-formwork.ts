import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import {
  castableHostIds,
  projectFormworkCaveats,
  solveProjectFormwork,
} from '@pascal-app/nodes/formwork-assembly/headless'
import { z } from 'zod'
import type { SceneOperations } from '../../operations'
import { NodeIdSchema } from '../schemas'
import { formworkScopeInput, noSuchLevel, round, sceneNodes, textResult } from './shared'

export const inspectProjectFormworkOutput = {
  scope: z.string(),
  elementCount: z.number(),
  shutterCount: z.number(),
  elements: z.array(
    z.object({
      id: z.string(),
      kind: z.string(),
      shutters: z.number(),
      pourUnits: z.number(),
      coversWholePour: z.boolean(),
    }),
  ),
  unshuttered: z.array(NodeIdSchema),
  bom: z.array(
    z.object({
      description: z.string(),
      catalogId: z.string().nullable(),
      provenance: z.string(),
      quantity: z.number(),
      unit: z.string(),
      totalWeightKg: z.number().nullable(),
    }),
  ),
  totalWeightKg: z.number(),
  totalWeightComplete: z.boolean(),
  beyondCapacity: z.array(
    z.object({ elementId: z.string(), mark: z.string(), utilisation: z.number() }),
  ),
  caveats: z.array(z.string()),
}

export function registerInspectProjectFormwork(server: McpServer, bridge: SceneOperations): void {
  server.registerTool(
    'inspect_project_formwork',
    {
      title: 'Inspect project formwork',
      description:
        'The formwork the whole job needs, as one bill. This is the scope a yard actually orders at: the same panel type on two walls is one line on a delivery note, and two per-element bills of it cannot be added together afterwards — so use this for any question about what a floor or a project needs, what it weighs, or what to order. Scope it with levelId to bill one level, which is how a pour is planned, or leave it off for the whole scene. Elements with no shutter yet are not in the bill at all, and are listed separately as unshuttered — a wall nobody has formed is not a wall that needs nothing. Read caveats first and lead with them: each one means every figure below it is wrong in a way the figures themselves cannot show.',
      inputSchema: formworkScopeInput,
      outputSchema: inspectProjectFormworkOutput,
    },
    async ({ elementIds, levelId }) => {
      const nodes = sceneNodes(bridge)
      if (levelId !== undefined && nodes[levelId]?.type !== 'level') return noSuchLevel(levelId)

      const scope = { hostIds: elementIds, parentId: levelId }
      const solution = solveProjectFormwork(nodes, scope)
      const scoped = new Set(castableHostIds(nodes, scope))
      const shuttered = new Set(solution.elements.map((element) => element.host.id as string))

      return textResult({
        scope: levelId ?? (elementIds ? 'the elements named' : 'whole scene'),
        elementCount: solution.elements.length,
        shutterCount: solution.shutterCount,
        elements: solution.elements.map((element) => ({
          id: element.host.id as string,
          kind: element.host.type,
          shutters: element.shutters.length,
          pourUnits: element.pourUnitCount,
          coversWholePour: element.coversWholePour,
        })),
        // Named rather than omitted. An element in scope with no shutter is the most
        // likely reason a total is lower than the caller expects, and it is invisible
        // in a bill that only lists what exists.
        unshuttered: [...scoped].filter((id) => !shuttered.has(id as string)) as string[],
        bom: solution.bom.map((line) => ({
          description: line.description,
          catalogId: line.catalogId ?? null,
          provenance: line.provenance as string,
          quantity: line.quantity,
          unit: line.unit,
          totalWeightKg: line.totalWeightKg === undefined ? null : round(line.totalWeightKg),
        })),
        totalWeightKg: round(solution.totalWeightKg),
        // False means some part has no published weight, so the total is the sum of
        // the ones that do. Do not quote it as the lifting weight of the set.
        totalWeightComplete: solution.totalWeightComplete,
        beyondCapacity: solution.beyondCapacityMarks.map((part) => ({
          elementId: part.hostId,
          mark: part.mark,
          utilisation: round(part.utilisation),
        })),
        caveats: projectFormworkCaveats(solution),
      })
    },
  )
}

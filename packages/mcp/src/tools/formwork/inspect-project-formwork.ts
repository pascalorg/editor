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
      fromOwnStock: z.number().optional(),
      toHire: z.number().optional(),
      consumed: z.number().optional(),
      daysHeld: z.number().nullable(),
      struckAs: z.string().nullable(),
      mixedPeriods: z.array(z.string()).optional(),
    }),
  ),
  totalWeightKg: z.number(),
  totalWeightComplete: z.boolean(),
  hire: z.object({
    standard: z.string(),
    basis: z.string(),
    longestDaysHeld: z.number(),
    periods: z.array(
      z.object({ struckAs: z.string(), days: z.number(), governingRule: z.string() }),
    ),
    assumed: z.array(z.string()),
    substitutedFromAnotherCodeFamily: z.boolean(),
  }),
  supply: z
    .object({
      fromOwnStock: z.number(),
      toHire: z.number(),
      consumed: z.number(),
      hiredAlteredHere: z.number(),
      hiredWeightKg: z.number().nullable(),
      ownedNotUsedHere: z.array(z.string()),
    })
    .optional(),
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
        'The formwork the whole job needs, as one bill. This is the scope a yard actually orders at: the same panel type on two walls is one line on a delivery note, and two per-element bills of it cannot be added together afterwards — so use this for any question about what a floor or a project needs, what it weighs, or what to order. Scope it with levelId to bill one level, which is how a pour is planned, or leave it off for the whole scene. Elements with no shutter yet are not in the bill at all, and are listed separately as unshuttered — a wall nobody has formed is not a wall that needs nothing. Read caveats first and lead with them: each one means every figure below it is wrong in a way the figures themselves cannot show. Where the project has recorded what the yard owns, every line also splits into fromOwnStock, toHire and consumed, and supply totals them; supply being absent means nobody has recorded any stock, so say that rather than implying the bill is all on hire. Two things about the split worth carrying to the user: it is for this scope only, because the same owned panels serve the next pour once stripped, so two levels’ owned figures are not a total; and hiredAlteredHere is a recharge at list price rather than a hire charge, because a hire company’s panel drilled for this pour does not come back as stock. Every line also carries daysHeld, how long that line stays on the job under the striking table the project’s code family publishes, with struckAs saying what it is held as — a slab’s deck comes off in 4 days and the props under it stay 10, so never quote one period for an element. daysHeld null means the part is not struck at all: a tie is cut off inside the wall, a release agent is used up. Three things never to do with these figures: do not add them, because hire.longestDaysHeld is when the last of the set comes free and a sum is a duration longer than the job; do not call them calendar days when hire.basis is qualifying-time, because ACI counts only hours above 10 °C and in a cold spell the strike date is later than the number reads; and do not multiply them by a rate, because no price is recorded anywhere in this model. Read hire.assumed and say which figures the job stated and which the code’s own default column supplied.',
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
        bom: solution.bom.map((line, index) => {
          const split = solution.supply?.lines[index]
          const held = solution.hire.lines[index]
          return {
            description: line.description,
            catalogId: line.catalogId ?? null,
            provenance: line.provenance as string,
            quantity: line.quantity,
            unit: line.unit,
            totalWeightKg: line.totalWeightKg === undefined ? null : round(line.totalWeightKg),
            // Only where the project has recorded a rack, so an absent field is "nobody
            // said what this project owns" rather than "nothing to hire". Indexed
            // because `bomSupply` returns the bill's own order.
            ...(split
              ? {
                  fromOwnStock: split.ownedQuantity,
                  toHire: split.hiredQuantity,
                  consumed: split.consumedQuantity,
                }
              : {}),
            // Null rather than 0 for a part nothing strikes — a tie is cut off inside
            // the wall, a release agent is used up. A 0 reads as plant returned the
            // same day.
            daysHeld: held?.hours === undefined ? null : round(held.hours / 24),
            struckAs: held?.striking?.target ?? null,
            ...(held?.mixed ? { mixedPeriods: held.mixed.targets as string[] } : {}),
          }
        }),
        totalWeightKg: round(solution.totalWeightKg),
        // False means some part has no published weight, so the total is the sum of
        // the ones that do. Do not quote it as the lifting weight of the set.
        totalWeightComplete: solution.totalWeightComplete,
        // Absent where the project has recorded no stock at all, which is not the same
        // claim as a yard that owns nothing — see the tool description.
        ...(solution.supply
          ? {
              supply: {
                fromOwnStock: solution.supply.ownedQuantity,
                toHire: solution.supply.hiredQuantity,
                consumed: solution.supply.consumedQuantity,
                hiredAlteredHere: solution.supply.hiredModifiedQuantity,
                hiredWeightKg:
                  solution.supply.hiredWeightKg === undefined
                    ? null
                    : round(solution.supply.hiredWeightKg),
                ownedNotUsedHere: solution.supply.unusedOwnedIds,
              },
            }
          : {}),
        // Never a total. A set is tied up for its slowest release, and a caller handed a
        // column of days will otherwise add them and quote a hire longer than the job.
        hire: {
          standard: solution.hire.standard as string,
          basis: solution.hire.basis as string,
          longestDaysHeld: round(solution.hire.longestHours / 24),
          periods: solution.hire.periods.map((period) => ({
            struckAs: period.target as string,
            days: round(period.days),
            governingRule: period.governingRule,
          })),
          assumed: solution.hire.assumed.map((entry) => entry.message),
          substitutedFromAnotherCodeFamily: solution.strikingStandardSubstituted,
        },
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

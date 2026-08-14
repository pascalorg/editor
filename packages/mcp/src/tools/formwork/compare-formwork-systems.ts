import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import {
  FORMWORK_VALUE_DESCRIPTION,
  formworkValueOptions,
  solveProjectFormwork,
  VALUE_REFUSAL_LABELS,
  VALUE_VERDICT_LABELS,
  type ValueDelta,
  valueCaveats,
} from '@pascal-app/nodes/formwork-assembly/headless'
import { z } from 'zod'
import type { SceneOperations } from '../../operations'
import { formworkScopeInput, noSuchLevel, refusal, round, sceneNodes, textResult } from './shared'

const deltaOutput = z.object({ from: z.number(), to: z.number(), delta: z.number() }).optional()

export const compareFormworkSystemsOutput = {
  scope: z.string(),
  currentSystemIds: z.array(z.string()),
  currency: z.string().optional(),
  options: z.array(
    z.object({
      key: z.string(),
      systemId: z.string(),
      label: z.string(),
      verdict: z.enum(['cheaper', 'dearer', 'level', 'not-priced']),
      verdictLabel: z.string(),
      cost: deltaOutput,
      hours: deltaOutput,
      picks: deltaOutput,
      loads: deltaOutput,
      weightKg: z.object({ from: z.number(), to: z.number(), delta: z.number() }),
      fittings: z.object({ from: z.number(), to: z.number(), delta: z.number() }),
      shortfall: deltaOutput,
      beyondCapacity: z.number(),
      incompleteElements: z.number(),
      gaps: z.array(z.string()),
    }),
  ),
  cheaperCount: z.number(),
  /** Registered systems with no design data — present but never offered. */
  unseededSystemIds: z.array(z.string()),
  refusalReason: z.string().optional(),
  caveats: z.array(z.string()),
}

/** Rounded on the way out, like every other money and weight this surface prints. */
function delta(value: ValueDelta | undefined) {
  if (value === undefined) return undefined
  return { from: round(value.from), to: round(value.to), delta: round(value.delta) }
}

/**
 * What else this job could be built in.
 *
 * The nineteenth tool here and the third that proposes a change rather than describing one —
 * after `fix_formwork_finding`, which repairs a defect, and `apply_pour_move`, which moves a
 * date. This is the first asked of a job with nothing wrong with it, which is what makes it
 * value engineering and what makes it the easiest of the three to answer dishonestly: every
 * figure it moves is a figure somebody quotes.
 *
 * ## Why it is a separate tool rather than a field on the takeoff
 *
 * Cost. Each option is the entire scope solved a second time, so a takeoff carrying its options
 * would pay for one solve per shipped system every time anybody read a bill. And the question is
 * asked at a different moment: the takeoff is read to place an order, and this is read once,
 * before the system is chosen, by somebody who is willing to change it.
 *
 * ## Why it does not write, when the write is one field
 *
 * Because the write is `set_formwork_settings parts.systemId` and that tool already exists — a
 * second path to the same field would be two ways to set one thing, which is the divergence the
 * whole layer is arranged against. So the option carries its key, the caveats name the call, and
 * the agent that takes one takes it through the tool that validates the id against the catalog.
 *
 * That is also the honest shape for this particular decision. A move is bounded by float the
 * model can see; a system is bounded by what the hire desk has on the rack next month, and
 * nothing here knows that. An agent applying "cheaper" unasked would be changing every wall in
 * the job on a comparison with no availability in it.
 */
export function registerCompareFormworkSystems(server: McpServer, bridge: SceneOperations): void {
  server.registerTool(
    'compare_formwork_systems',
    {
      title: 'Weigh this job against the other panel systems',
      description: FORMWORK_VALUE_DESCRIPTION,
      inputSchema: formworkScopeInput,
      outputSchema: compareFormworkSystemsOutput,
    },
    async ({ elementIds, levelId }) => {
      const nodes = sceneNodes(bridge)
      if (levelId !== undefined && nodes[levelId]?.type !== 'level') return noSuchLevel(levelId)

      const scope = {
        ...(elementIds ? { hostIds: elementIds } : {}),
        ...(levelId ? { parentId: levelId } : {}),
      }
      const solution = solveProjectFormwork(nodes, scope)
      const value = formworkValueOptions(nodes, scope, solution)
      // A refusal is refused rather than returned as an empty list, for the reason every refusal
      // on this surface is: a reply of zero options reads as "no alternative is better", and
      // "nothing is formed yet" is a different sentence with a different next call.
      if (value.refusal !== undefined) {
        return refusal(`${VALUE_REFUSAL_LABELS[value.refusal]}.`)
      }

      return textResult({
        scope: levelId ?? (elementIds ? 'the elements named' : 'whole scene'),
        currentSystemIds: value.currentSystemIds,
        ...(value.currency === undefined ? {} : { currency: value.currency }),
        unseededSystemIds: value.unseededSystemIds,
        options: value.options.map((option) => ({
          key: option.key,
          systemId: option.systemId,
          label: option.label,
          verdict: option.verdict,
          verdictLabel: VALUE_VERDICT_LABELS[option.verdict],
          ...(delta(option.cost) ? { cost: delta(option.cost) } : {}),
          ...(delta(option.hours) ? { hours: delta(option.hours) } : {}),
          ...(delta(option.picks) ? { picks: delta(option.picks) } : {}),
          ...(delta(option.loads) ? { loads: delta(option.loads) } : {}),
          weightKg: delta(option.weightKg) as { from: number; to: number; delta: number },
          fittings: delta(option.fittings) as { from: number; to: number; delta: number },
          ...(delta(option.shortfall) ? { shortfall: delta(option.shortfall) } : {}),
          beyondCapacity: option.beyondCapacity,
          incompleteElements: option.incompleteElements,
          gaps: option.gaps,
        })),
        cheaperCount: value.cheaper.length,
        caveats: valueCaveats(value),
      })
    },
  )
}

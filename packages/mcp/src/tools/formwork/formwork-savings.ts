import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import {
  FORMWORK_SAVINGS_DESCRIPTION,
  formworkSavings,
  savingCaveats,
  solveProjectFormwork,
} from '@pascal-app/nodes/formwork-assembly/headless'
import { z } from 'zod'
import type { SceneOperations } from '../../operations'
import { formworkScopeInput, noSuchLevel, round, sceneNodes, textResult } from './shared'

const axisOutput = z.object({
  label: z.string(),
  from: z.number(),
  to: z.number(),
  delta: z.number(),
  unit: z.string(),
})

const proposalOutput = z.object({
  class: z.enum(['substitution', 'cycle', 'reuse', 'grid-relaxation', 'standardisation']),
  key: z.string(),
  target: z.string(),
  alternative: z.string(),
  description: z.string(),
  saving: axisOutput.optional(),
  currency: z.string().optional(),
  tradeOffs: z.array(axisOutput),
  write: z.enum(['system', 'pour-move']),
})

const classRefusalOutput = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('nothing-cheaper'), note: z.string() }),
  z.object({ kind: z.literal('missing-input'), needs: z.string() }),
])

const classOutput = z.object({
  proposals: z.array(proposalOutput),
  refusal: classRefusalOutput.optional(),
})

export const formworkSavingsOutput = {
  scope: z.string(),
  currency: z.string().optional(),
  proposals: z.array(proposalOutput),
  classes: z.object({
    substitution: classOutput,
    cycle: classOutput,
    reuse: classOutput,
    'grid-relaxation': classOutput,
    standardisation: classOutput,
  }),
  caveats: z.array(z.string()),
}

/** Rounded on the way out, like every other money and weight this surface prints. */
function axis(value: { label: string; from: number; to: number; delta: number; unit: string }) {
  return {
    label: value.label,
    from: round(value.from),
    to: round(value.to),
    delta: round(value.delta),
    unit: value.unit,
  }
}

/**
 * The cheaper way to form the same building, in money.
 *
 * `compare_formwork_systems` says the job could be built in another system and prices the
 * difference; this turns that and the resequencer's moves into *proposals* — keyed, priced off
 * the same cost model as the printed total, and takeable whole by key through `apply_saving`.
 * A class that produced no proposal says whether nothing cheaper exists or it could not be
 * evaluated for a named missing input, and no total of claimed savings is offered.
 */
export function registerFormworkSavings(server: McpServer, bridge: SceneOperations): void {
  server.registerTool(
    'formwork_savings',
    {
      title: 'Name the cheaper way to form this scope',
      description: FORMWORK_SAVINGS_DESCRIPTION,
      inputSchema: formworkScopeInput,
      outputSchema: formworkSavingsOutput,
    },
    async ({ elementIds, levelId }) => {
      const nodes = sceneNodes(bridge)
      if (levelId !== undefined && nodes[levelId]?.type !== 'level') return noSuchLevel(levelId)

      const scope = {
        ...(elementIds ? { hostIds: elementIds } : {}),
        ...(levelId ? { parentId: levelId } : {}),
      }
      const solution = solveProjectFormwork(nodes, scope)
      const savings = formworkSavings(nodes, scope, solution)

      const classOf = (
        savingClass: 'substitution' | 'cycle' | 'reuse' | 'grid-relaxation' | 'standardisation',
      ) => {
        const outcome = savings.classes[savingClass]
        return {
          proposals: outcome.proposals.map((proposal) => ({
            class: proposal.class,
            key: proposal.key,
            target: proposal.target,
            alternative: proposal.alternative,
            description: proposal.description,
            ...(proposal.saving ? { saving: axis(proposal.saving) } : {}),
            ...(proposal.currency ? { currency: proposal.currency } : {}),
            tradeOffs: proposal.tradeOffs.map(axis),
            write: proposal.write,
          })),
          ...(outcome.refusal ? { refusal: outcome.refusal } : {}),
        }
      }

      return textResult({
        scope: levelId ?? (elementIds ? 'the elements named' : 'whole scene'),
        ...(savings.currency === undefined ? {} : { currency: savings.currency }),
        proposals: savings.proposals.map((proposal) => ({
          class: proposal.class,
          key: proposal.key,
          target: proposal.target,
          alternative: proposal.alternative,
          description: proposal.description,
          ...(proposal.saving ? { saving: axis(proposal.saving) } : {}),
          ...(proposal.currency ? { currency: proposal.currency } : {}),
          tradeOffs: proposal.tradeOffs.map(axis),
          write: proposal.write,
        })),
        classes: {
          substitution: classOf('substitution'),
          cycle: classOf('cycle'),
          reuse: classOf('reuse'),
          'grid-relaxation': classOf('grid-relaxation'),
          standardisation: classOf('standardisation'),
        },
        caveats: savingCaveats(savings),
      })
    },
  )
}

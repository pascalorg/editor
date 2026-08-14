import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import {
  APPLY_SAVING_DESCRIPTION,
  applyPourDatePatch,
  applySavingInput,
  FORMWORK_SYSTEMS,
} from '@pascal-app/core/formwork'
import type { AnyNode, AnyNodeId } from '@pascal-app/core/schema'
import {
  formworkSavings,
  plannedSaving,
  savingOutcome,
  solveProjectFormwork,
} from '@pascal-app/nodes/formwork-assembly/headless'
import { z } from 'zod'
import type { Patch } from '../../bridge/scene-bridge'
import type { SceneOperations } from '../../operations'
import { publishLiveSceneSnapshot } from '../live-sync'
import { refusal, round, sceneNodes, textResult } from './shared'

export const applySavingOutput = {
  savingKey: z.string(),
  class: z.enum(['substitution', 'cycle']),
  achieved: z.boolean(),
  predicted: z.object({ amount: z.number(), currency: z.string().optional() }).optional(),
  measured: z.object({ amount: z.number(), currency: z.string().optional() }).optional(),
  unmeasured: z.string().optional(),
  /** The system written onto each shutter — a substitution's whole change. */
  systemWrites: z.array(z.object({ assemblyId: z.string(), systemId: z.string() })).optional(),
  /** The dates written, for a cycle — the move's own writes. */
  moved: z.array(z.object({ assemblyId: z.string(), from: z.string(), to: z.string() })).optional(),
  message: z.string(),
}

/**
 * Taking a saving proposal — the last write here, and the first that applies a *priced*
 * decision.
 *
 * `apply_pour_move` takes a move by key and re-solves; this takes a saving by key, applies the
 * whole change (a substitution writes the candidate system onto every shutter in scope, a cycle
 * is the move's own writes), and reports what a second solve actually measured beside what the
 * proposal claimed. The measurement is the answer in either direction, and a re-derivation that
 * cannot produce a figure is unmeasured rather than confirmed at the claim.
 *
 * It records a design decision and nothing else: nothing is committed, hired or ordered by it,
 * and the commitment to a supplier remains a separate act.
 */
export function registerApplySaving(server: McpServer, bridge: SceneOperations): void {
  server.registerTool(
    'apply_saving',
    {
      title: 'Take a saving proposal',
      description: APPLY_SAVING_DESCRIPTION,
      inputSchema: applySavingInput,
      outputSchema: applySavingOutput,
    },
    async ({ savingKey: key }) => {
      const nodes = sceneNodes(bridge)
      const before = solveProjectFormwork(nodes)
      const savings = formworkSavings(nodes, {}, before)
      const plan = plannedSaving(savings, before, key)
      if (plan.refusal !== undefined) {
        return refusal(plan.refusal)
      }

      const patches: Patch[] = []
      if (plan.class === 'substitution') {
        for (const write of plan.writes ?? []) {
          const assembly = nodes[write.assemblyId]
          if (assembly === undefined || assembly.type !== 'formwork-assembly') {
            return refusal(`Error: ${write.assemblyId} is no longer a shutter in this scene.`)
          }
          // The same refusal a hand-made set_formwork_settings gives for an unknown id: the
          // plan's alternative came off the catalog, and a scene that no longer has the system
          // it was read against is a scene the write must not guess about.
          if (FORMWORK_SYSTEMS[write.systemId] === undefined) {
            return refusal(`Error: ${write.systemId} is not a registered formwork system.`)
          }
          patches.push({
            op: 'update',
            id: write.assemblyId as AnyNodeId,
            data: { systemId: write.systemId } as Partial<AnyNode>,
          })
        }
      } else {
        // A cycle is the move's own writes, through the same gate a hand-made set_pour_date
        // passes — the shift is arithmetic on a date the project stated.
        for (const write of plan.movePlan?.writes ?? []) {
          const dated = applyPourDatePatch({ pourAt: write.pourAt })
          if (dated.error !== undefined) return refusal(dated.error)
          patches.push({
            op: 'update',
            id: write.assemblyId as AnyNodeId,
            data: dated.writes as Partial<AnyNode>,
          })
        }
      }
      // One patch over every write, for `apply_pour_move`'s reason: a substitution that half
      // landed prices as neither the old design nor the new one, and the spec refuses a partial
      // application outright.
      bridge.applyPatch(patches)
      await publishLiveSceneSnapshot(bridge, 'apply_saving')

      const after = solveProjectFormwork(sceneNodes(bridge))
      const outcome = savingOutcome(before, after, plan)

      return textResult({
        savingKey: key,
        class: plan.class,
        achieved: outcome.achieved,
        ...(outcome.predicted
          ? {
              predicted: {
                amount: round(outcome.predicted.amount),
                ...(outcome.predicted.currency ? { currency: outcome.predicted.currency } : {}),
              },
            }
          : {}),
        ...(outcome.measured
          ? {
              measured: {
                amount: round(outcome.measured.amount),
                ...(outcome.measured.currency ? { currency: outcome.measured.currency } : {}),
              },
            }
          : {}),
        ...(outcome.unmeasured ? { unmeasured: outcome.unmeasured } : {}),
        ...(plan.class === 'substitution'
          ? { systemWrites: plan.writes }
          : {
              moved: (plan.movePlan?.writes ?? []).map((write) => ({
                assemblyId: write.assemblyId,
                from: write.wasPourAt,
                to: write.pourAt,
              })),
            }),
        message: outcome.message,
      })
    },
  )
}

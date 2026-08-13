import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import {
  APPLY_POUR_MOVE_DESCRIPTION,
  applyPourDatePatch,
  applyPourMoveInput,
} from '@pascal-app/core/formwork'
import type { AnyNode, AnyNodeId } from '@pascal-app/core/schema'
import {
  moveOutcome,
  plannedMove,
  solveProjectFormwork,
} from '@pascal-app/nodes/formwork-assembly/headless'
import { z } from 'zod'
import type { Patch } from '../../bridge/scene-bridge'
import type { SceneOperations } from '../../operations'
import { publishLiveSceneSnapshot } from '../live-sync'
import { refusal, sceneNodes, textResult } from './shared'

export const applyPourMoveOutput = {
  moveKey: z.string(),
  catalogId: z.string(),
  pourId: z.string(),
  days: z.number(),
  moved: z.array(z.object({ assemblyId: z.string(), from: z.string(), to: z.string() })),
  cleared: z.boolean(),
  peakBefore: z.number(),
  /** What a second sweep of the written programme found. */
  measuredPeak: z.number().nullable(),
  /** What the proposal said it would find. Kept beside the measurement, never instead of it. */
  predictedPeak: z.number(),
  stillShortBy: z.number().nullable(),
  raisedElsewhere: z.array(
    z.object({
      catalogId: z.string(),
      description: z.string(),
      from: z.number(),
      to: z.number(),
    }),
  ),
  message: z.string(),
}

/**
 * Taking a resequencing proposal — the second write here whose subject is this engine's own
 * output rather than the building.
 *
 * `fix_formwork_finding` applies a decision the validator made; this applies one the takeoff
 * made, and it is defensible for the same reason: it re-solves the whole project afterwards
 * and reports the peak that sweep measured. A tool that returned the proposal's own
 * `peakAfter` would be quoting the arithmetic that proposed the move, which is the one figure
 * an agent has no way to check for itself.
 *
 * ## Why the prediction is reported beside the measurement
 *
 * Because `resequence.ts` proposes a move by applying it to a *copy* of the programme and
 * re-sweeping, which is the honest way to propose one and is still a prediction. The write
 * lands in the real scene, where a pour may have been dated since the proposal was read. Where
 * the two disagree the measurement is the answer, and the disagreement is worth returning in
 * both directions: a measurement better than the prediction is the same fault as one worse.
 *
 * ## Why it re-dates every member and refuses rather than skipping one
 *
 * A monolithic pour is cast in one operation, so it moves whole. Each member is shifted from
 * its own date rather than onto the group's, because two walls cast together can be programmed
 * a day apart and writing one date to both would silently close a gap the programme had. A
 * member carrying no date at all is a refusal: half an operation cannot be moved, and the peak
 * the proposal was measured against was swept over all of them.
 *
 * ## Why it does not commit
 *
 * `commit_pour`'s division, one step further along. The pour has just moved, so the new day is
 * one nobody has taken to the hire desk — applying a move leaves it an intent, which is what it
 * is, and agreeing it is the second decision made second.
 */
export function registerApplyPourMove(server: McpServer, bridge: SceneOperations): void {
  server.registerTool(
    'apply_pour_move',
    {
      title: 'Apply a resequencing proposal',
      description: APPLY_POUR_MOVE_DESCRIPTION,
      inputSchema: applyPourMoveInput,
      outputSchema: applyPourMoveOutput,
    },
    async ({ moveKey: key }) => {
      const before = solveProjectFormwork(sceneNodes(bridge))
      const plan = plannedMove(before, key)
      if (plan.refusal !== undefined || plan.writes === undefined) {
        return refusal(plan.refusal ?? 'Nothing to apply for that move.')
      }

      // Through the same gate a hand-made `set_pour_date` passes. The shift is arithmetic on a
      // date the project stated, so a refusal here means the stored date was already impossible.
      const patches: Patch[] = []
      for (const write of plan.writes) {
        const dated = applyPourDatePatch({ pourAt: write.pourAt })
        if (dated.error !== undefined) return refusal(dated.error)
        patches.push({
          op: 'update',
          id: write.assemblyId as AnyNodeId,
          data: dated.writes as Partial<AnyNode>,
        })
      }
      // One patch over every member, for `attach_formwork`'s reason: a monolithic pour that
      // half-landed would be an operation split across two days nobody programmed.
      bridge.applyPatch(patches)
      await publishLiveSceneSnapshot(bridge, 'apply_pour_move')

      const after = solveProjectFormwork(sceneNodes(bridge))
      const outcome = moveOutcome(before, after, plan)

      return textResult({
        moveKey: key,
        catalogId: plan.catalogId as string,
        pourId: plan.pourId as string,
        days: plan.days as number,
        moved: outcome.moved.map((write) => ({
          assemblyId: write.assemblyId,
          from: write.wasPourAt,
          to: write.pourAt,
        })),
        cleared: outcome.cleared,
        peakBefore: outcome.peakBefore,
        measuredPeak: outcome.measuredPeak ?? null,
        predictedPeak: outcome.predictedPeak,
        stillShortBy: outcome.shortfallAfter ?? null,
        raisedElsewhere: outcome.raised,
        message: outcome.message,
      })
    },
  )
}

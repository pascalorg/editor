import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import {
  applyCommitPourPatch,
  COMMIT_POUR_DESCRIPTION,
  commitPourInput,
  unknownAssembly,
} from '@pascal-app/core/formwork'
import type { AnyNode, AnyNodeId } from '@pascal-app/core/schema'
import { z } from 'zod'
import type { SceneOperations } from '../../operations'
import { publishLiveSceneSnapshot } from '../live-sync'
import { refusal, sceneNodes, textResult } from './shared'

export const commitPourOutput = {
  assemblyId: z.string(),
  elementId: z.string().nullable(),
  committedPourAt: z.string().nullable(),
  message: z.string(),
}

/**
 * That a pour date is agreed rather than merely intended — the one fact in the programme
 * that comes from outside the model entirely.
 *
 * Every other write here records something about the building. This records something
 * about a conversation: the hire desk has the day, the following trade has been told. It
 * is on this surface because an agent that can date a pour and cannot commit one is an
 * agent whose resequencing proposals will keep offering to move a pour that is booked,
 * every time it reads the takeoff.
 *
 * The input takes no date, and that is the tool's whole shape. What is stored is the day
 * agreed, but the caller is asked only whether *this pour* is agreed, and the day comes
 * off the pour — because a caller made to restate it could commit to a day the programme
 * does not have, and a booking against a date nobody scheduled is worse than none. Which
 * also means an undated pour is refused rather than committed to nothing.
 *
 * Moving a committed pour afterwards is deliberately not blocked, here or in the store.
 * Sites move booked pours; refusing the edit would make somebody release the commitment
 * first and lose the record of what was agreed. The drift is reported instead, which is
 * the honest form of it — a call to make, not a figure to reconcile.
 */
export function registerCommitPour(server: McpServer, bridge: SceneOperations): void {
  server.registerTool(
    'commit_pour',
    {
      title: 'Commit pour date',
      description: COMMIT_POUR_DESCRIPTION,
      inputSchema: commitPourInput,
      outputSchema: commitPourOutput,
    },
    async ({ assemblyId, committed }) => {
      const nodes = sceneNodes(bridge)
      const assembly = nodes[assemblyId]
      if (assembly === undefined || assembly.type !== 'formwork-assembly') {
        return refusal(unknownAssembly(assemblyId))
      }

      const result = applyCommitPourPatch({ committed }, assembly.pourAt, assemblyId)
      if (result.error !== undefined) return refusal(result.error)

      bridge.updateNode(assemblyId as AnyNodeId, result.writes as Partial<AnyNode>)
      await publishLiveSceneSnapshot(bridge, 'commit_pour')

      return textResult({
        assemblyId,
        elementId: (assembly.parentId as string | undefined) ?? null,
        committedPourAt: result.writes.committedPourAt ?? null,
        message: committed
          ? `ok — ${result.recorded}. The resequencing proposals in inspect_project_formwork will now leave this pour where it is; if the date later moves, the same read reports the drift off the booking.`
          : `ok — ${result.recorded}. The pour keeps its date and goes back to being an intent, so the proposals may offer to move it again.`,
      })
    },
  )
}

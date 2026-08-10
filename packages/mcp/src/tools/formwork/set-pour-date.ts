import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import {
  applyPourDatePatch,
  pourDatePatchInput,
  SET_POUR_DATE_DESCRIPTION,
  unknownAssembly,
} from '@pascal-app/core/formwork'
import type { AnyNode, AnyNodeId } from '@pascal-app/core/schema'
import { z } from 'zod'
import type { SceneOperations } from '../../operations'
import { publishLiveSceneSnapshot } from '../live-sync'
import { refusal, sceneNodes, textResult } from './shared'

export const setPourDateOutput = {
  assemblyId: z.string(),
  elementId: z.string().nullable(),
  pourAt: z.string().nullable(),
  message: z.string(),
}

/**
 * The day one pour is cast — the only input in the formwork model that turns the periods
 * into a calendar, and the only write here addressed to a shutter rather than an element.
 *
 * That target is the whole design of the tool. A 9 m wall capped at 3 m lifts is three
 * pours a week apart, so a date on the wall could only be one of them, and a tool that
 * accepted an element id would have to pick — silently, and differently from whichever
 * lift the user meant. `unknownAssembly` is shared with the editor's own AI so the
 * likeliest mistake, an element id where an assembly id belongs, is refused in one wording
 * that names the read which actually lists pours.
 *
 * Nothing is derived. There is no variant that dates the next lift from this one and no
 * lag from the pour before it, because nothing in the model records what a pour waits on —
 * and a programme inferred from the order the shutters happen to be in would print beside
 * geometry that genuinely is derived, reading with the same authority.
 */
export function registerSetPourDate(server: McpServer, bridge: SceneOperations): void {
  server.registerTool(
    'set_pour_date',
    {
      title: 'Set pour date',
      description: SET_POUR_DATE_DESCRIPTION,
      inputSchema: pourDatePatchInput,
      outputSchema: setPourDateOutput,
    },
    async ({ assemblyId, pourAt }) => {
      const nodes = sceneNodes(bridge)
      const assembly = nodes[assemblyId]
      if (assembly === undefined || assembly.type !== 'formwork-assembly') {
        return refusal(unknownAssembly(assemblyId))
      }

      // Validated before anything is written, so a refused date leaves the pour
      // programmed exactly as it was rather than half-changed.
      const result = applyPourDatePatch({ pourAt })
      if (result.error !== undefined) return refusal(result.error)

      // An explicit `undefined` deletes the key rather than storing it — the store's own
      // contract, and the only way to say "this pour is unprogrammed" in a schema where an
      // absent field is what encodes it.
      bridge.updateNode(assemblyId as AnyNodeId, result.writes as Partial<AnyNode>)
      await publishLiveSceneSnapshot(bridge, 'set_pour_date')

      return textResult({
        assemblyId,
        // The host named back, because the caller asked about a wall and was made to
        // address a shutter — this is the sentence that reconnects the two.
        elementId: (assembly.parentId as string | undefined) ?? null,
        pourAt: result.writes.pourAt ?? null,
        message: `ok — ${result.recorded}. Read inspect_project_formwork for the delivery and strike dates this produces.`,
      })
    },
  )
}

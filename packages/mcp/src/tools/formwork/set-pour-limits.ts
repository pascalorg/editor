import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import {
  applyPourLimitsPatch,
  describePourSplit,
  pourLimitsPatchInput,
  SET_POUR_LIMITS_DESCRIPTION,
} from '@pascal-app/core/formwork'
import type { AnyNode, AnyNodeId } from '@pascal-app/core/schema'
import {
  formworkCoverageCaveat,
  pourUnitsForHost,
} from '@pascal-app/nodes/formwork-assembly/headless'
import { z } from 'zod'
import type { SceneOperations } from '../../operations'
import { publishLiveSceneSnapshot } from '../live-sync'
import { castableOrRefusal, refusal, sceneNodeList, sceneNodes, textResult } from './shared'

export const setPourLimitsOutput = {
  elementId: z.string(),
  kind: z.string(),
  changed: z.array(z.string()),
  pourUnitCount: z.number(),
  shutterCount: z.number(),
  coverageCaveat: z.string().nullable(),
  message: z.string(),
}

/**
 * How many separately cast units an element is — and the one write here whose *reply*
 * carries the failure rather than its effect.
 *
 * The write itself is three optional numbers on a node. What makes it worth its own tool
 * is what it does to the shutters, which is nothing: capping a 9 m wall at 3 m lifts
 * turns one pour unit into three and builds no shutters for the other two. So between
 * this call and the next `attach_formwork`, the element is cast in more pours than it is
 * formed for, and every quantity anybody reads in that window — panel counts, weights,
 * hire periods — is short by the difference, with nothing in the numbers marking it.
 *
 * `formworkCoverageCaveat` is that sentence, and it is shared with the editor's own AI
 * and with `inspect_formwork_parts` for a reason: a limit changed here and a bill read
 * there have to report one fault in one wording. Two phrasings of one short takeoff is
 * how a user comes to believe there are two problems, and a third-of-the-truth bill that
 * reads as complete on one surface is the failure the caveat exists to prevent.
 *
 * It stays silent about an element nobody has formed. That element's problem is that it
 * has no shutter at all, which is `attach_formwork`'s own sentence, and two remedies in
 * one reply is one too many for a model to choose between.
 */
export function registerSetPourLimits(server: McpServer, bridge: SceneOperations): void {
  server.registerTool(
    'set_pour_limits',
    {
      title: 'Set pour limits',
      description: SET_POUR_LIMITS_DESCRIPTION,
      inputSchema: pourLimitsPatchInput,
      outputSchema: setPourLimitsOutput,
    },
    async ({ elementId, ...limits }) => {
      const nodes = sceneNodes(bridge)
      const host = castableOrRefusal(nodes, elementId)
      if ('isError' in host) return host

      // Validated before anything is written, so a refused call leaves the element cast
      // exactly as it was.
      const result = applyPourLimitsPatch(host.type, limits)
      if (result.error !== undefined) return refusal(result.error)

      // An explicit `undefined` deletes the key rather than storing it — the store's own
      // contract, and the only way to say "this element has no cap" in a schema where an
      // absent field is what encodes it.
      bridge.updateNode(elementId as AnyNodeId, result.writes as Partial<AnyNode>)
      await publishLiveSceneSnapshot(bridge, 'set_pour_limits')

      const after = sceneNodeList(bridge)
      const updated = (after.find((node) => node.id === elementId) ?? host) as typeof host
      const units = pourUnitsForHost(updated, after)
      const shutterCount = after.filter(
        (node) => node.type === 'formwork-assembly' && node.parentId === elementId,
      ).length
      const caveat = formworkCoverageCaveat(elementId, shutterCount, Math.max(1, units.length))

      const summary = `ok — ${describePourSplit(units)}`
      return textResult({
        elementId,
        kind: host.type as string,
        changed: result.changed,
        pourUnitCount: Math.max(1, units.length),
        shutterCount,
        coverageCaveat: caveat ?? null,
        message: [summary, result.caveat, caveat].filter(Boolean).join('. '),
      })
    },
  )
}

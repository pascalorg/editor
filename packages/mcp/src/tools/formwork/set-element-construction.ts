import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import {
  applyConstructionPatch,
  constructionPatchInput,
  SET_ELEMENT_CONSTRUCTION_DESCRIPTION,
} from '@pascal-app/core/formwork'
import type { AnyNode, AnyNodeId } from '@pascal-app/core/schema'
import { z } from 'zod'
import type { SceneOperations } from '../../operations'
import { publishLiveSceneSnapshot } from '../live-sync'
import { castableOrRefusal, refusal, sceneNodeList, sceneNodes, textResult } from './shared'

export const setElementConstructionOutput = {
  elementId: z.string(),
  kind: z.string(),
  changed: z.array(z.string()),
  shutterCount: z.number(),
  formworkOutstanding: z.boolean(),
  message: z.string(),
}

/**
 * How one element is built and cast — the write every other formwork answer is solved
 * from, and the one that most needs a follow-up it cannot make itself.
 *
 * The fields read like preferences and are structural decisions. `castOrder` is not an
 * annotation: a face butting concrete already hardened is not formed, so a pour sequence
 * typed in the wrong order produces a complete, plausible bill for a shutter with two
 * stop-ends it does not need. `exposureClass` decides whether a tie may pass through the
 * section at all. Which is why the description tells the agent to ask rather than guess,
 * and why it is core's description — the guidance is the tool, and guidance present on one
 * surface and absent on the other is a guessed value on whichever surface lacks it.
 *
 * `formworkOutstanding` is the part worth the extra read. Naming a system forms nothing,
 * so this call's most likely failure is success: `formworkType: 'steel-panel'` written,
 * reported ok, and no `attach_formwork` behind it — a project that believes it specified a
 * steel-panel wall and holds no shutter, no bill, and nothing on screen. The flag is set
 * when this call turned forming on and the element still has no shutter, and the message
 * names the next call rather than leaving it as a field.
 */
export function registerSetElementConstruction(server: McpServer, bridge: SceneOperations): void {
  server.registerTool(
    'set_element_construction',
    {
      title: 'Set element construction',
      description: SET_ELEMENT_CONSTRUCTION_DESCRIPTION,
      inputSchema: constructionPatchInput,
      outputSchema: setElementConstructionOutput,
    },
    async ({ elementId, ...fields }) => {
      const nodes = sceneNodes(bridge)
      const host = castableOrRefusal(nodes, elementId)
      if ('isError' in host) return host

      // Validated before anything is written, so a refused call — a slab-only field on a
      // wall, most likely — leaves the element built exactly as it was.
      const result = applyConstructionPatch(host.type, host.formworkType, fields, elementId)
      if (result.error !== undefined) return refusal(result.error)

      bridge.updateNode(elementId as AnyNodeId, result.writes as Partial<AnyNode>)
      await publishLiveSceneSnapshot(bridge, 'set_element_construction')

      const shutterCount = sceneNodeList(bridge).filter(
        (node) => node.type === 'formwork-assembly' && node.parentId === elementId,
      ).length
      const outstanding = result.formingTurnedOn && shutterCount === 0
      return textResult({
        elementId,
        kind: host.type as string,
        changed: result.changed,
        shutterCount,
        formworkOutstanding: outstanding,
        message: outstanding
          ? `ok — ${result.changed.join(', ')}. Nothing is built yet: call attach_formwork on ${elementId} to raise the shutter.`
          : `ok — ${result.changed.join(', ')}`,
      })
    },
  )
}

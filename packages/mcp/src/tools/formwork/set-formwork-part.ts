import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import {
  applyFormworkPartPatch,
  formworkPartPatchInput,
  noFormworkAssembly,
  partByMark,
  partLabel,
  SET_FORMWORK_PART_DESCRIPTION,
  unknownPartMark,
} from '@pascal-app/core/formwork'
import type { AnyNode, AnyNodeId } from '@pascal-app/core/schema'
import { solveShuttersForHost } from '@pascal-app/nodes/formwork-assembly/headless'
import { z } from 'zod'
import type { SceneOperations } from '../../operations'
import { publishLiveSceneSnapshot } from '../live-sync'
import { castableOrRefusal, refusal, sceneNodes, textResult } from './shared'

export const setFormworkPartOutput = {
  mark: z.string(),
  assemblyId: z.string(),
  part: z.string(),
  recorded: z.array(z.string()),
  message: z.string(),
}

/**
 * A decision about one part of a solved shutter — and the first MCP write whose *input*
 * has to be re-derived before it can be validated.
 *
 * The settings write merges a group and every field in it is checkable on its own. A
 * mark is not: it names a position in a layout that exists nowhere in the scene graph,
 * so the only way to know whether `P-A-1-01800` is a part of this wall is to solve the
 * wall and look. That is why this tool runs the solve on a *write* path, which nothing
 * else here does.
 *
 * Resolving it is not optional politeness. `partOverrides` is keyed by mark and accepts
 * any string, so a mark the model misremembered writes cleanly and then sits in the
 * project as a stale edit — reported by `inspect_formwork_parts` as somebody's forgotten
 * decision about a part that was never edited, for the rest of the job. The refusal is
 * the only thing standing between a hallucinated mark and that.
 *
 * The two refusals are deliberately different sentences, and core owns both so the chat
 * surface says the same words: a bad mark on a shuttered wall is a lookup to redo, where
 * an unshuttered element needs `attach_formwork` first, and one merged message sends the
 * agent to the wrong one.
 */
export function registerSetFormworkPart(server: McpServer, bridge: SceneOperations): void {
  server.registerTool(
    'set_formwork_part',
    {
      title: 'Set formwork part',
      description: SET_FORMWORK_PART_DESCRIPTION,
      inputSchema: formworkPartPatchInput,
      outputSchema: setFormworkPartOutput,
    },
    async ({ catalogId, elementId, mark, note, omitted }) => {
      const nodes = sceneNodes(bridge)
      const host = castableOrRefusal(nodes, elementId)
      if ('isError' in host) return host

      const shutters = solveShuttersForHost(host, nodes)
      const target = shutters.find((shutter) => partByMark(shutter.parts, mark) !== undefined)
      if (!target) {
        const known = shutters.reduce((total, shutter) => total + shutter.parts.length, 0)
        return refusal(
          known === 0
            ? noFormworkAssembly(elementId, mark)
            : unknownPartMark(elementId, mark, known),
        )
      }

      // Validated after the mark resolves and before anything is written, so a refused
      // call leaves the assembly's overrides exactly as they stood.
      const result = applyFormworkPartPatch(target.assembly.partOverrides, {
        catalogId,
        mark,
        note,
        omitted,
      })
      if (result.error !== undefined) return refusal(result.error)

      bridge.updateNode(
        target.assembly.id as AnyNodeId,
        {
          partOverrides: result.overrides,
        } as Partial<AnyNode>,
      )
      // The whole graph, applied browser-side through `setScene` — so no dirty sweep,
      // and none available: the MCP bridge has no renderer to notify.
      await publishLiveSceneSnapshot(bridge, 'set_formwork_part')

      const part = partByMark(target.parts, mark)
      const label = part ? partLabel(part) : 'Part'
      return textResult({
        mark,
        assemblyId: target.assembly.id as string,
        part: label,
        recorded: result.recorded,
        message: `ok — ${label} ${mark}: ${result.recorded.join(', ')}`,
      })
    },
  )
}

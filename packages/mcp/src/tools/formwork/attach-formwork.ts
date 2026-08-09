import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import {
  ATTACH_FORMWORK_DESCRIPTION,
  describeFormworkReconciliation,
  noFormworkTypeSet,
} from '@pascal-app/core/formwork'
import type { AnyNode, AnyNodeId, FormworkAssemblyNode } from '@pascal-app/core/schema'
import { buildSolverJointNodes } from '@pascal-app/nodes/construction-joint/headless'
import { reconcileFormworkNodes } from '@pascal-app/nodes/formwork-assembly/headless'
import { z } from 'zod'
import type { Patch } from '../../bridge/scene-bridge'
import type { SceneOperations } from '../../operations'
import { publishLiveSceneSnapshot } from '../live-sync'
import { castableOrRefusal, refusal, sceneNodeList, sceneNodes, textResult } from './shared'

export const attachFormworkOutput = {
  elementId: z.string(),
  assemblyIds: z.array(z.string()),
  added: z.number(),
  kept: z.number(),
  removed: z.number(),
  discardedPartDecisions: z.number(),
  joints: z.number(),
  message: z.string(),
}

/**
 * The shutters an element needs, built — and the first MCP write that can *destroy*
 * recorded work.
 *
 * Everything else on this surface edits: a settings field, a part override. This builds
 * the layout, which makes it the one call whose second invocation is dangerous rather
 * than redundant. Appending would leave two copies of every shutter — a doubled bill,
 * every mark duplicated, and a part somebody marked "already on site" quietly re-ordered
 * on the copy. Rebuilding indiscriminately would throw away every per-part decision the
 * pair above just made recordable. And a second call is the *expected* case, not the
 * mistake: a pour-limit change tells the agent to come back here.
 *
 * So it reconciles. `reconcileFormworkNodes` is the same function the panel's button and
 * the editor's chat tool call, and the reply is core's sentence, so a rebuild reported
 * here and re-read in the editor is the same rebuild described the same way. What it
 * removed and what that cost is in the message because nothing else records it: an
 * orphaned shutter's `partOverrides` die with the node, and a count of them is the only
 * trace the user will ever get.
 *
 * ## Three things this layer does differently from the panel and the chat tool
 *
 * 1. **One `applyPatch`, not N calls.** The deletes, the new assemblies and the new
 *    joints are dry-run together and applied together, so a rebuild cannot half-land —
 *    an element with its old shutters deleted and its new ones rejected by the schema is
 *    an element formed for nothing. It is also one undo step, which matters because a
 *    Ctrl-Z that took the shutters and left the joints would strand work with nothing to
 *    build it.
 * 2. **No `children` bookkeeping.** The store appends to any parent whose schema has
 *    `children` and strips the entry on delete. The chat tool hand-maintains it only
 *    because it mutates a plain `SceneGraph` with no store behind it.
 * 3. **No dirty sweep.** The panel marks the survivors, because a shutter built against
 *    the old split has stale geometry and `updateNode` reaches only the edited node.
 *    Here `publishLiveSceneSnapshot` ships the whole graph for a browser-side `setScene`,
 *    which rebuilds from scratch — and this process has no renderer to notify anyway.
 */
export function registerAttachFormwork(server: McpServer, bridge: SceneOperations): void {
  server.registerTool(
    'attach_formwork',
    {
      title: 'Attach formwork',
      description: ATTACH_FORMWORK_DESCRIPTION,
      inputSchema: { elementId: z.string().min(1) },
      outputSchema: attachFormworkOutput,
    },
    async ({ elementId }) => {
      const nodes = sceneNodes(bridge)
      const host = castableOrRefusal(nodes, elementId)
      if ('isError' in host) return host
      // Nothing is shuttered on the user's behalf. An attach that picked a system would
      // put a bill on the job nobody specified.
      if (host.formworkType === undefined || host.formworkType === 'none') {
        return refusal(noFormworkTypeSet(elementId))
      }

      const levelNodes = sceneNodeList(bridge)
      const existing = levelNodes
        .filter((node) => node.type === 'formwork-assembly' && node.parentId === elementId)
        .map((node) => node as unknown as FormworkAssemblyNode)
      const { create, keep, orphan } = reconcileFormworkNodes(host, existing, levelNodes)
      const discarded = orphan.reduce(
        (total, assembly) => total + Object.keys(assembly.partOverrides ?? {}).length,
        0,
      )
      // Each cut between two pour units is a real construction joint carrying roughening
      // and starter bars, so it has to exist as a node or the work is invisible to the
      // takeoff. Parented to the level, because a joint is an interface rather than a
      // part of either side.
      const joints = buildSolverJointNodes(host, levelNodes)

      const patches: Patch[] = [
        ...orphan.map(
          (assembly): Patch => ({ op: 'delete', id: assembly.id as AnyNodeId, cascade: true }),
        ),
        ...create.map(
          (assembly): Patch => ({
            op: 'create',
            node: assembly as unknown as AnyNode,
            parentId: elementId as AnyNodeId,
          }),
        ),
        ...joints.map(
          (joint): Patch => ({
            op: 'create',
            node: joint as unknown as AnyNode,
            parentId: (joint.parentId as AnyNodeId | null) ?? undefined,
          }),
        ),
      ]
      if (patches.length > 0) bridge.applyPatch(patches)
      await publishLiveSceneSnapshot(bridge, 'attach_formwork')

      return textResult({
        elementId,
        assemblyIds: [...keep, ...create].map((assembly) => assembly.id as string),
        added: create.length,
        kept: keep.length,
        removed: orphan.length,
        discardedPartDecisions: discarded,
        joints: joints.length,
        message: describeFormworkReconciliation({
          existing: existing.length,
          keep: keep.length,
          create: create.length,
          orphan: orphan.length,
          discardedPartDecisions: discarded,
          joints: joints.length,
        }),
      })
    },
  )
}

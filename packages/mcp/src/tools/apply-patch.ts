import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { isAgentRefusal } from '@pascal-app/core/agent-tools'
import type { AnyNode, AnyNodeId } from '@pascal-app/core/schema'
import { z } from 'zod'
import type { Patch as BridgePatch } from '../bridge/scene-bridge'
import type { SceneOperations } from '../operations'
import { DESTRUCTIVE_TOOL_ANNOTATIONS } from './annotations'
import { ErrorCode, McpError, refusalResult, throwMcpError } from './errors'
import './honest-patch-guard'
import { liveSyncOutput, persistencePayload, publishLiveSceneSnapshot } from './live-sync'
import { assertPatchKeepsIdentity, PatchRefusedError, runPatchGuards } from './patch-guards'
import { PatchSchema } from './schemas'

export const applyPatchInput = {
  patches: z.array(PatchSchema),
}

export const applyPatchOutput = {
  appliedOps: z.number(),
  deletedIds: z.array(z.string()),
  createdIds: z.array(z.string()),
  ...liveSyncOutput,
}

export function registerApplyPatch(server: McpServer, bridge: SceneOperations): void {
  server.registerTool(
    'apply_patch',
    {
      title: 'Apply patch',
      description:
        "Apply a batch of create/update/delete operations atomically. All patches are validated before any are applied; the entire batch forms a single undo step. Batch-first is the default: prefer one apply_patch call containing all create/update/delete ops for a build step, in stable order so later ops can reference ids created by earlier ops. A single call is atomic (all or nothing) and pays the snapshot and save cost once; do not loop one-op calls. A create whose id already exists fails the whole patch with node_exists; to replace a node, delete it earlier in the same patch. An update cannot change id or type (identity_change) or object or children (immutable_field); restating the current value is fine. A parentId change must name an existing node that holds children (invalid_parent). An update cannot add schema issues to a node (invalid_update). After a delete or a roof update that regenerates a roof's default gutters, those gutters and their downspouts are addressable only in a later call (regenerated_default). Refusals come back as a tool error whose text is JSON {code, patchIndex, id, message}.",
      inputSchema: applyPatchInput,
      outputSchema: applyPatchOutput,
      annotations: DESTRUCTIVE_TOOL_ANNOTATIONS,
    },
    async ({ patches }) => {
      const bridgePatches: BridgePatch[] = patches.map((p) => {
        if (p.op === 'create') {
          return {
            op: 'create',
            node: p.node as unknown as AnyNode,
            ...(p.parentId !== undefined ? { parentId: p.parentId as AnyNodeId } : {}),
          }
        }
        if (p.op === 'update') {
          return {
            op: 'update',
            id: p.id as AnyNodeId,
            data: p.data as Partial<AnyNode>,
          }
        }
        return {
          op: 'delete',
          id: p.id as AnyNodeId,
          ...(p.cascade !== undefined ? { cascade: p.cascade } : {}),
        }
      })

      try {
        runPatchGuards(bridgePatches, bridge.getNodes() as Record<string, AnyNode>)
        const planDeletion = (bridge as { planDeletion?: SceneOperations['planDeletion'] })
          .planDeletion
        assertPatchKeepsIdentity(
          bridgePatches,
          bridge.getNodes(),
          bridge.getRootNodeIds(),
          typeof planDeletion === 'function' ? planDeletion.bind(bridge) : undefined,
        )
        const result = bridge.applyPatch(bridgePatches)
        const persistence = await publishLiveSceneSnapshot(bridge, 'apply_patch')
        const payload = {
          appliedOps: result.appliedOps,
          deletedIds: result.deletedIds as unknown as string[],
          createdIds: result.createdIds as unknown as string[],
          ...persistencePayload(persistence),
        }
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(payload) }],
          structuredContent: payload,
        }
      } catch (err) {
        if (err instanceof PatchRefusedError) {
          // A tool error, not an McpError: the SDK keeps only an McpError's
          // message, and clients need the code, index and id to act on it.
          const refusal = {
            code: err.code,
            patchIndex: err.patchIndex,
            id: err.nodeId,
            message: err.message,
          }
          return {
            content: [{ type: 'text' as const, text: JSON.stringify(refusal) }],
            isError: true,
          }
        }
        // A refusal the store made (an accidental wipe) answers with its code, as the shared tools'.
        if (isAgentRefusal(err)) return refusalResult(err)
        if (err instanceof McpError) throw err
        const msg = err instanceof Error ? err.message : String(err)
        throwMcpError(ErrorCode.InvalidParams, msg)
      }
    },
  )
}

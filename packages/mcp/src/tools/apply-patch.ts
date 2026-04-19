import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { AnyNode, AnyNodeId } from '@pascal-app/core/schema'
import { z } from 'zod'
import type { Patch as BridgePatch, SceneBridge } from '../bridge/scene-bridge'
import { ErrorCode, throwMcpError } from './errors'
import { PatchSchema } from './schemas'

export const applyPatchInput = {
  patches: z.array(PatchSchema),
}

export const applyPatchOutput = {
  appliedOps: z.number(),
  deletedIds: z.array(z.string()),
  createdIds: z.array(z.string()),
}

export function registerApplyPatch(server: McpServer, bridge: SceneBridge): void {
  server.registerTool(
    'apply_patch',
    {
      title: 'Apply patch',
      description:
        'Apply a batch of create/update/delete operations atomically. All patches are validated before any are applied; the entire batch forms a single undo step.',
      inputSchema: applyPatchInput,
      outputSchema: applyPatchOutput,
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
        const result = bridge.applyPatch(bridgePatches)
        const payload = {
          appliedOps: result.appliedOps,
          deletedIds: result.deletedIds as unknown as string[],
          createdIds: result.createdIds as unknown as string[],
        }
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(payload) }],
          structuredContent: payload,
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        throwMcpError(ErrorCode.InvalidParams, msg)
      }
    },
  )
}

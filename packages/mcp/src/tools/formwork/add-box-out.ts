import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { ADD_BOX_OUT_DESCRIPTION, buildBoxOutNode } from '@pascal-app/core/formwork'
import type { AnyNode, AnyNodeId } from '@pascal-app/core/schema'
import { z } from 'zod'
import type { Patch } from '../../bridge/scene-bridge'
import type { SceneOperations } from '../../operations'
import { publishLiveSceneSnapshot } from '../live-sync'
import { refusal, sceneNodes, textResult } from './shared'

export const addBoxOutOutput = {
  boxOutId: z.string(),
  hostId: z.string(),
  width: z.number(),
  height: z.number(),
  draftAngleDeg: z.number().nullable(),
  chamferStrips: z.boolean().nullable(),
  message: z.string(),
}

/**
 * The one write on this surface that creates a node outside the attach/reconcile
 * machinery — and the simplest of them all, because the host does the work.
 *
 * A box-out is a void, not a shutter: the host's own layout cuts its panels
 * around it and returns the reveals, so this tool only has to record the void
 * with the right parent. That parent is what the whole contract hangs on — the
 * shutter reads openings by `parentId`, the dirty-scope re-cuts the host when
 * the box-out moves, and the scene's loader keeps a node only if its parent is
 * in the graph — so a box-out written with no parent would survive the reply
 * and vanish on the next load.
 */
export function registerAddBoxOut(server: McpServer, bridge: SceneOperations): void {
  server.registerTool(
    'add_box_out',
    {
      title: 'Add box-out',
      description: ADD_BOX_OUT_DESCRIPTION,
      inputSchema: {
        elementId: z.string().min(1),
        position: z.tuple([z.number(), z.number(), z.number()]),
        width: z.number().positive(),
        height: z.number().positive(),
        draftAngleDeg: z.number().min(0).max(10).optional(),
        chamferStrips: z.boolean().optional(),
      },
      outputSchema: addBoxOutOutput,
    },
    async ({ elementId, position, width, height, draftAngleDeg, chamferStrips }) => {
      const nodes = sceneNodes(bridge)
      const host = nodes[elementId]
      if (host === undefined) {
        return refusal(
          `no element with id ${elementId}. Call list_castable_elements and read the id of the wall or slab the void is in.`,
        )
      }
      const built = buildBoxOutNode(host, {
        elementId,
        position,
        width,
        height,
        draftAngleDeg,
        chamferStrips,
      })
      if ('error' in built) return refusal(built.error)

      // One patch, parented to the host: the store appends to the host's children,
      // and the host schema now admits a box-out id, so the void survives the next
      // parse rather than being stripped from its own parent.
      const patches: Patch[] = [
        {
          op: 'create',
          node: built.node as unknown as AnyNode,
          parentId: elementId as AnyNodeId,
        },
      ]
      bridge.applyPatch(patches)
      await publishLiveSceneSnapshot(bridge, 'add_box_out')

      return textResult({
        boxOutId: built.node.id as string,
        hostId: elementId,
        width,
        height,
        draftAngleDeg: draftAngleDeg ?? null,
        chamferStrips: chamferStrips ?? null,
        message: `ok — box-out ${built.node.id} created in ${elementId}; the host shutter re-cuts around the ${width} × ${height} m void${draftAngleDeg !== undefined ? ` at ${draftAngleDeg}° draft` : ''}${chamferStrips ? ' with chamfer strips' : ''} and the four reveals are on the parts list.`,
      })
    },
  )
}

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { AnyNodeId } from '@pascal-app/core/schema'
import { ItemNode } from '@pascal-app/core/schema'
import { z } from 'zod'
import type { SceneBridge } from '../bridge/scene-bridge'
import { ErrorCode, throwMcpError } from './errors'
import { NodeIdSchema, Vec3Schema } from './schemas'

export const placeItemInput = {
  catalogItemId: z.string().min(1),
  targetNodeId: NodeIdSchema,
  position: Vec3Schema,
  rotation: z.number().optional(),
}

export const placeItemOutput = {
  itemId: z.string(),
  status: z.string().optional(),
}

/** Compute wallT (0..1) from a 3D position projected onto the wall centreline. */
function computeWallT(
  start: [number, number],
  end: [number, number],
  position: [number, number, number],
): number {
  const [sx, sz] = start
  const [ex, ez] = end
  const dx = ex - sx
  const dz = ez - sz
  const lenSq = dx * dx + dz * dz
  if (lenSq === 0) return 0
  const px = position[0] - sx
  const pz = position[2] - sz
  const t = (px * dx + pz * dz) / lenSq
  return Math.max(0, Math.min(1, t))
}

export function registerPlaceItem(server: McpServer, bridge: SceneBridge): void {
  server.registerTool(
    'place_item',
    {
      title: 'Place item',
      description:
        'Place a catalog item into the scene, attaching it to a wall, ceiling, or site. In headless mode the catalog is unavailable, so the asset payload is a placeholder — `status: "catalog_unavailable"` indicates this.',
      inputSchema: placeItemInput,
      outputSchema: placeItemOutput,
    },
    async ({ catalogItemId, targetNodeId, position, rotation }) => {
      const target = bridge.getNode(targetNodeId as AnyNodeId)
      if (!target) {
        throwMcpError(ErrorCode.InvalidParams, `Target node not found: ${targetNodeId}`)
      }
      const targetType = target.type
      if (targetType !== 'wall' && targetType !== 'ceiling' && targetType !== 'site') {
        throwMcpError(
          ErrorCode.InvalidRequest,
          `Cannot place item on ${targetType}; target must be a wall, ceiling, or site`,
        )
      }

      const baseAsset = {
        id: catalogItemId,
        name: catalogItemId,
        category: 'unknown',
        thumbnail: '',
        src: 'asset://placeholder',
        dimensions: [0.5, 0.5, 0.5] as [number, number, number],
        offset: [0, 0, 0] as [number, number, number],
        rotation: [0, 0, 0] as [number, number, number],
        scale: [1, 1, 1] as [number, number, number],
      }

      const wallExtras: { wallId: string; wallT: number } | Record<string, never> =
        targetType === 'wall'
          ? {
              wallId: targetNodeId,
              wallT: computeWallT(
                (target as { start: [number, number] }).start,
                (target as { end: [number, number] }).end,
                position as [number, number, number],
              ),
            }
          : {}

      const item = ItemNode.parse({
        position: position as [number, number, number],
        rotation: [0, rotation ?? 0, 0],
        asset: baseAsset,
        ...wallExtras,
      })
      const id = bridge.createNode(item, targetNodeId as AnyNodeId)
      const payload = {
        itemId: id as string,
        status: 'catalog_unavailable',
      }
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(payload) }],
        structuredContent: payload,
      }
    },
  )
}

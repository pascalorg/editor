import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { AnyNodeId } from '@pascal-app/core/schema'
import { ItemNode } from '@pascal-app/core/schema'
import { z } from 'zod'
import { bundledCatalog } from '../catalog/bundled'
import type { AssetCatalog } from '../catalog/types'
import type { SceneOperations } from '../operations'
import { ADDITIVE_TOOL_ANNOTATIONS } from './annotations'
import { ErrorCode, throwMcpError } from './errors'
import { projectWorldPointToWallLocalX, wallLength } from './geometry'
import { liveSyncOutput, persistencePayload, publishLiveSceneSnapshot } from './live-sync'
import { measurement } from './measurement'
import { NodeIdSchema, Vec3Schema } from './schemas'

export const placeItemInput = {
  catalogItemId: z.string().min(1),
  targetNodeId: NodeIdSchema,
  position: Vec3Schema,
  rotation: measurement('angle', 'rad', { description: 'Y-axis rotation.' }).optional(),
}

export const placeItemOutput = {
  itemId: z.string(),
  status: z.string().optional(),
  ...liveSyncOutput,
}

export function registerPlaceItem(
  server: McpServer,
  bridge: SceneOperations,
  assetCatalog: AssetCatalog = bundledCatalog,
): void {
  server.registerTool(
    'place_item',
    {
      title: 'Place item',
      description:
        'Place a catalog item into the scene. Target a level/slab/zone for floor items, a wall for wall-attached items, or a ceiling for ceiling-attached items. Do not target the site node directly.',
      inputSchema: placeItemInput,
      outputSchema: placeItemOutput,
      annotations: { ...ADDITIVE_TOOL_ANNOTATIONS, openWorldHint: assetCatalog.usesNetwork },
    },
    async ({ catalogItemId, targetNodeId, position, rotation }) => {
      const snapshot = await assetCatalog.snapshot()
      const target = bridge.getNode(targetNodeId as AnyNodeId)
      if (!target) {
        throwMcpError(ErrorCode.InvalidParams, `Target node not found: ${targetNodeId}`)
      }
      const targetType = target.type
      if (
        targetType !== 'level' &&
        targetType !== 'slab' &&
        targetType !== 'zone' &&
        targetType !== 'wall' &&
        targetType !== 'ceiling'
      ) {
        throwMcpError(
          ErrorCode.InvalidRequest,
          `Cannot place item on ${targetType}; target must be a level, slab, zone, wall, or ceiling. Site-level placement is not supported yet because site.children is reserved for buildings.`,
        )
      }

      const catalogAsset = snapshot.items.find((item) => item.id === catalogItemId)
      if (!catalogAsset) {
        throwMcpError(
          ErrorCode.InvalidParams,
          `Catalog item is not available: ${catalogItemId}. Search the current catalog before placing it. ${snapshot.status.message}`,
        )
      }

      const requestedPosition = position as [number, number, number]
      const parentId =
        targetType === 'slab' || targetType === 'zone'
          ? bridge.resolveLevelId(targetNodeId as AnyNodeId)
          : targetNodeId

      if (!parentId) {
        throwMcpError(
          ErrorCode.InvalidParams,
          `Could not resolve a level parent for target ${targetNodeId}`,
        )
      }

      const wallExtras: { wallId: string; wallT: number } | Record<string, never> = {}
      let itemPosition = requestedPosition

      if (targetType === 'wall') {
        const localX = projectWorldPointToWallLocalX(target, requestedPosition)
        const length = wallLength(target)
        itemPosition = [localX, requestedPosition[1], 0]
        Object.assign(wallExtras, {
          wallId: targetNodeId,
          wallT: length === 0 ? 0 : localX / length,
        })
      }

      const item = ItemNode.parse({
        position: itemPosition,
        rotation: [0, rotation ?? 0, 0],
        asset: catalogAsset,
        ...wallExtras,
      })
      const id = bridge.createNode(item, parentId as AnyNodeId)
      const persistence = await publishLiveSceneSnapshot(bridge, 'place_item')
      const payload = {
        itemId: id as string,
        status: 'ok',
        ...persistencePayload(persistence),
      }
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(payload) }],
        structuredContent: payload,
      }
    },
  )
}

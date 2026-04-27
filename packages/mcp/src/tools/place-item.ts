import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { AnyNodeId } from '@pascal-app/core/schema'
import { ItemNode } from '@pascal-app/core/schema'
import { z } from 'zod'
import type { SceneBridge } from '../bridge/scene-bridge'
import type { SceneStore } from '../storage/types'
import { findCatalogItem } from './asset-catalog'
import { ErrorCode, throwMcpError } from './errors'
import { projectWorldPointToWallLocalX, wallLength } from './geometry'
import { publishLiveSceneSnapshot } from './live-sync'
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

export function registerPlaceItem(
  server: McpServer,
  bridge: SceneBridge,
  store?: SceneStore,
): void {
  server.registerTool(
    'place_item',
    {
      title: 'Place item',
      description:
        'Place a catalog item into the scene. Target a level/slab/zone for floor items, a wall for wall-attached items, a ceiling for ceiling-attached items, or the site for outdoor items.',
      inputSchema: placeItemInput,
      outputSchema: placeItemOutput,
    },
    async ({ catalogItemId, targetNodeId, position, rotation }) => {
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
        targetType !== 'ceiling' &&
        targetType !== 'site'
      ) {
        throwMcpError(
          ErrorCode.InvalidRequest,
          `Cannot place item on ${targetType}; target must be a level, slab, zone, wall, ceiling, or site`,
        )
      }

      const catalogAsset = findCatalogItem(catalogItemId)
      const baseAsset = catalogAsset ?? {
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
        asset: baseAsset,
        ...wallExtras,
      })
      const id = bridge.createNode(item, parentId as AnyNodeId)
      await publishLiveSceneSnapshot(bridge, store, 'place_item')
      const payload = {
        itemId: id as string,
        status: catalogAsset ? 'ok' : 'catalog_unavailable',
      }
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(payload) }],
        structuredContent: payload,
      }
    },
  )
}

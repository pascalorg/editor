import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import {
  flushMountRotation,
  geometrySurfaceAt,
  geometryUndersideAt,
  mountsFlush,
} from '@pascal-app/core'
import { projectWorldPointToWallLocalX, wallLength } from '@pascal-app/core/agent-operations'
import type { AnyNodeId } from '@pascal-app/core/schema'
import { ItemNode } from '@pascal-app/core/schema'
import { z } from 'zod'
import type { SceneOperations } from '../operations'
import { ADDITIVE_TOOL_ANNOTATIONS } from './annotations'
import { findCatalogItem } from './asset-catalog'
import { ErrorCode, throwMcpError } from './errors'
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
  restingOn: z.string().optional(),
  ...liveSyncOutput,
}

export function registerPlaceItem(server: McpServer, bridge: SceneOperations): void {
  server.registerTool(
    'place_item',
    {
      title: 'Place item',
      description:
        'Place a catalog item into the scene. Target a level/slab/zone for floor items, a wall for wall-attached items, a ceiling for ceiling-attached items, or an item to rest on it (position in level coordinates; on an object built with add_object it lands on the real surface below the point, such as a porch landing, and a ceiling item hangs from the underside above it, such as a vaulted ceiling, unless position[1] is set above 0). Do not target the site node directly.',
      inputSchema: placeItemInput,
      outputSchema: placeItemOutput,
      annotations: ADDITIVE_TOOL_ANNOTATIONS,
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
        targetType !== 'item'
      ) {
        throwMcpError(
          ErrorCode.InvalidRequest,
          `Cannot place item on ${targetType}; target must be a level, slab, zone, wall, ceiling or item. Site-level placement is not supported yet because site.children is reserved for buildings.`,
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

      let restingOn: string | undefined
      let tilt: [number, number, number] | undefined
      if (target.type === 'item') {
        const host = bridge.getNode(target.parentId as AnyNodeId)
        if (host?.type !== 'level') {
          throwMcpError(
            ErrorCode.InvalidRequest,
            `Item ${targetNodeId} rests on a ${host?.type ?? 'missing parent'}; only items standing on a level can host another item here.`,
          )
        }
        // Level coordinates → the host item's frame (translation + yaw).
        const [hx, hy, hz] = target.position
        const yaw = target.rotation[1] ?? 0
        const dx = requestedPosition[0] - hx
        const dz = requestedPosition[2] - hz
        const lx = (Math.cos(yaw) * dx - Math.sin(yaw) * dz) / target.scale[0]
        const lz = (Math.sin(yaw) * dx + Math.cos(yaw) * dz) / target.scale[2]
        const hanging = baseAsset.attachTo === 'ceiling' && target.source
        const surface = target.source
          ? hanging
            ? geometryUndersideAt(target.source.manifest, lx, lz)
            : geometrySurfaceAt(target.source.manifest, lx, lz)
          : null
        const explicitY = !hanging && requestedPosition[1] > 0
        restingOn = explicitY ? undefined : surface?.part
        // A ceiling item hangs below the underside (its top flush); others rest on top.
        const flush = Boolean(hanging) && mountsFlush(baseAsset)
        const drop = hanging ? (flush ? 0.02 : (baseAsset.dimensions?.[1] ?? 0)) : 0
        const ly = explicitY
          ? requestedPosition[1] - hy
          : surface
            ? surface.y * target.scale[1] - drop
            : (target.asset.surface?.height ?? target.asset.dimensions[1]) * target.scale[1]
        itemPosition = [lx * target.scale[0], ly, lz * target.scale[2]]
        // A recessed fixture tilts with a sloped underside (a can in a vault plane).
        // Its turn is relative to the host's.
        tilt =
          flush && surface && 'normal' in surface
            ? flushMountRotation(surface.normal, (rotation ?? 0) - yaw)
            : [0, (rotation ?? 0) - yaw, 0]
      }

      const item = ItemNode.parse({
        position: itemPosition,
        rotation: tilt ?? [0, rotation ?? 0, 0],
        asset: baseAsset,
        ...wallExtras,
      })
      const id = bridge.createNode(item, parentId as AnyNodeId)
      const persistence = await publishLiveSceneSnapshot(bridge, 'place_item')
      const payload = {
        itemId: id as string,
        status: catalogAsset ? 'ok' : 'catalog_unavailable',
        ...(restingOn ? { restingOn } : {}),
        ...persistencePayload(persistence),
      }
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(payload) }],
        structuredContent: payload,
      }
    },
  )
}

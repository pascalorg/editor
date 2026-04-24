import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { AnyNode, AnyNodeId, AnyNodeType } from '@pascal-app/core/schema'
import { pointInPolygon } from '@pascal-app/core/spatial-grid'
import { z } from 'zod'
import type { SceneBridge } from '../bridge/scene-bridge'
import { NodeIdSchema } from './schemas'

const ALL_NODE_TYPES = [
  'site',
  'building',
  'level',
  'wall',
  'fence',
  'zone',
  'slab',
  'ceiling',
  'roof',
  'roof-segment',
  'stair',
  'stair-segment',
  'item',
  'door',
  'window',
  'scan',
  'guide',
] as const

export const findNodesInput = {
  type: z.enum(ALL_NODE_TYPES).optional(),
  parentId: NodeIdSchema.optional(),
  levelId: NodeIdSchema.optional(),
  zoneId: NodeIdSchema.optional(),
}

export const findNodesOutput = {
  nodes: z.array(z.record(z.string(), z.unknown())),
}

/** Compute a representative 2D point (x, z) for zone-filtering. */
function getPointForZoneFilter(node: AnyNode): [number, number] | null {
  if (node.type === 'wall' || node.type === 'fence') {
    const [x1, z1] = node.start
    const [x2, z2] = node.end
    return [(x1 + x2) / 2, (z1 + z2) / 2]
  }
  if (
    node.type === 'item' ||
    node.type === 'door' ||
    node.type === 'window' ||
    node.type === 'building' ||
    node.type === 'stair' ||
    node.type === 'roof'
  ) {
    const [x, , z] = node.position
    return [x, z]
  }
  if (node.type === 'slab' || node.type === 'ceiling' || node.type === 'zone') {
    const poly = node.polygon as Array<[number, number]> | undefined
    if (!poly || poly.length === 0) return null
    let cx = 0
    let cz = 0
    for (const [x, z] of poly) {
      cx += x
      cz += z
    }
    return [cx / poly.length, cz / poly.length]
  }
  return null
}

export function registerFindNodes(server: McpServer, bridge: SceneBridge): void {
  server.registerTool(
    'find_nodes',
    {
      title: 'Find nodes',
      description:
        'Find nodes matching any combination of type, parentId, levelId, or zoneId filters.',
      inputSchema: findNodesInput,
      outputSchema: findNodesOutput,
    },
    async (args) => {
      const { type, parentId, levelId, zoneId } = args as {
        type?: AnyNodeType
        parentId?: string
        levelId?: string
        zoneId?: string
      }

      // Delegate type/parent/level filtering to the bridge.
      const baseFilter: {
        type?: AnyNodeType
        parentId?: AnyNodeId
        levelId?: AnyNodeId
      } = {}
      if (type !== undefined) baseFilter.type = type
      if (parentId !== undefined) baseFilter.parentId = parentId as AnyNodeId
      if (levelId !== undefined) baseFilter.levelId = levelId as AnyNodeId
      let results = bridge.findNodes(baseFilter)

      // Zone-polygon filter: point-in-polygon on a representative 2D point.
      if (zoneId) {
        const zone = bridge.getNode(zoneId as AnyNodeId)
        if (!zone || zone.type !== 'zone') {
          // Unknown zoneId → return empty list rather than throw; matches
          // typical "filter" semantics.
          results = []
        } else {
          const poly = zone.polygon
          results = results.filter((n) => {
            const pt = getPointForZoneFilter(n)
            if (!pt) return false
            return pointInPolygon(pt[0], pt[1], poly)
          })
        }
      }

      const payload = {
        nodes: results as unknown as Array<Record<string, unknown>>,
      }
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(payload) }],
        structuredContent: payload,
      }
    },
  )
}

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { AnyNodeId, ItemNode } from '@pascal-app/core/schema'
import { getScaledDimensions } from '@pascal-app/core/schema'
import { z } from 'zod'
import type { SceneBridge } from '../bridge/scene-bridge'
import { NodeIdSchema } from './schemas'

export const checkCollisionsInput = {
  levelId: NodeIdSchema.optional(),
}

export const checkCollisionsOutput = {
  collisions: z.array(
    z.object({
      aId: z.string(),
      bId: z.string(),
      kind: z.string(),
    }),
  ),
}

type AABB = { minX: number; maxX: number; minZ: number; maxZ: number }

function itemAabb(item: ItemNode): AABB {
  const [x, , z] = item.position
  const [w, , d] = getScaledDimensions(item)
  const halfW = w / 2
  const halfD = d / 2
  return {
    minX: x - halfW,
    maxX: x + halfW,
    minZ: z - halfD,
    maxZ: z + halfD,
  }
}

function aabbOverlap(a: AABB, b: AABB): boolean {
  return a.minX < b.maxX && a.maxX > b.minX && a.minZ < b.maxZ && a.maxZ > b.minZ
}

export function registerCheckCollisions(server: McpServer, bridge: SceneBridge): void {
  server.registerTool(
    'check_collisions',
    {
      title: 'Check collisions',
      description:
        'Detect overlapping item footprints via an axis-aligned 2D bounding-box test. Optionally scoped to a single level.',
      inputSchema: checkCollisionsInput,
      outputSchema: checkCollisionsOutput,
    },
    async ({ levelId }) => {
      const filter: { type: 'item'; levelId?: AnyNodeId } = { type: 'item' }
      if (levelId) filter.levelId = levelId as AnyNodeId
      const items = bridge.findNodes(filter) as ItemNode[]

      const boxes = items.map((i) => ({ item: i, aabb: itemAabb(i) }))
      const collisions: { aId: string; bId: string; kind: string }[] = []
      for (let i = 0; i < boxes.length; i++) {
        for (let j = i + 1; j < boxes.length; j++) {
          const a = boxes[i]!
          const b = boxes[j]!
          if (aabbOverlap(a.aabb, b.aabb)) {
            collisions.push({
              aId: a.item.id as string,
              bId: b.item.id as string,
              kind: 'item-aabb',
            })
          }
        }
      }

      const payload = { collisions }
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(payload) }],
        structuredContent: payload,
      }
    },
  )
}

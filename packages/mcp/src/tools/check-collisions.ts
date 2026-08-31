import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { AnyNodeId } from '@pascal-app/core/schema'
import { z } from 'zod'
import type { SceneOperations } from '../operations'
import { findItemItemCollisions } from './layout-clearance'
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

export function registerCheckCollisions(server: McpServer, bridge: SceneOperations): void {
  server.registerTool(
    'check_collisions',
    {
      title: 'Check collisions',
      description:
        'Detect overlapping item footprints via a rotation-aware plan AABB test. Optionally scoped to a single level (items parented to that level).',
      inputSchema: checkCollisionsInput,
      outputSchema: checkCollisionsOutput,
    },
    async ({ levelId }) => {
      const nodes = Object.values(bridge.getNodes())
      let scoped = nodes
      if (levelId) {
        const levelItems = new Set(
          bridge
            .findNodes({ type: 'item', levelId: levelId as AnyNodeId })
            .map((n) => n.id as string),
        )
        scoped = nodes.filter((n) => n.type !== 'item' || levelItems.has(n.id))
      }

      // gap: 0 keeps this tool's contract — it reports *actual* overlap.
      // findItemItemCollisions defaults to DEFAULT_ITEM_GAP (8cm), which is the
      // breathing room furnish_room wants when placing new items; applied here
      // it would report items merely standing close together as colliding.
      const found = findItemItemCollisions({
        nodes: scoped,
        levelId: levelId as string | undefined,
        gap: 0,
      })
      const collisions = found.map((c) => ({
        aId: c.aId,
        bId: c.bId,
        kind: c.kind,
      }))

      const payload = { collisions }
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(payload) }],
        structuredContent: payload,
      }
    },
  )
}

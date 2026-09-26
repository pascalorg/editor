import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { AnyNode, AnyNodeId } from '@pascal-app/core/schema'
import { z } from 'zod'
import type { SceneOperations } from '../operations'
import { READ_ONLY_TOOL_ANNOTATIONS } from './annotations'
import { ErrorCode, throwMcpError } from './errors'
import { resolveNodeWorldPoint } from './node-world-point'
import { NodeIdSchema } from './schemas'

export const measureInput = {
  fromId: NodeIdSchema,
  toId: NodeIdSchema,
}

export const measureOutput = {
  distanceMeters: z.number(),
  fromPoint: z.array(z.number()).optional(),
  toPoint: z.array(z.number()).optional(),
  areaSqMeters: z.number().optional(),
  units: z.literal('meters'),
  areaUnits: z.literal('square_meters').optional(),
}

/** Compute polygon area via the shoelace formula. */
function shoelaceArea(polygon: Array<[number, number]>): number {
  if (polygon.length < 3) return 0
  let sum = 0
  const n = polygon.length
  for (let i = 0; i < n; i++) {
    const [x1, z1] = polygon[i]!
    const [x2, z2] = polygon[(i + 1) % n]!
    sum += x1 * z2 - x2 * z1
  }
  return Math.abs(sum) / 2
}

export function registerMeasure(server: McpServer, bridge: SceneOperations): void {
  server.registerTool(
    'measure',
    {
      title: 'Measure',
      description:
        "Measure the distance (in meters) between two nodes, or the net area of a polygon node when fromId === toId. Distance is between world-space reference points, returned as fromPoint/toPoint: a positioned node's origin in its host's frame (an item's base, a door's or window's centre in its wall), a wall's or fence's midpoint at its base, a slab's, ceiling's or zone's polygon centroid on its plane, a block's or imported mesh's vertex-bounds centre, a level's plan centre on its base plane, and another container's descendants' centre.",
      inputSchema: measureInput,
      outputSchema: measureOutput,
      annotations: READ_ONLY_TOOL_ANNOTATIONS,
    },
    async ({ fromId, toId }) => {
      const from = bridge.getNode(fromId as AnyNodeId)
      if (!from) {
        throwMcpError(ErrorCode.InvalidParams, `Node not found: ${fromId}`)
      }
      const to = bridge.getNode(toId as AnyNodeId)
      if (!to) {
        throwMcpError(ErrorCode.InvalidParams, `Node not found: ${toId}`)
      }

      // Self-measurement: compute area for polygon-bearing nodes.
      if (fromId === toId) {
        const n = from as AnyNode
        if (n.type === 'zone' || n.type === 'slab' || n.type === 'ceiling') {
          const holes = n.type === 'zone' ? [] : n.holes
          const holeArea = Array.isArray(holes)
            ? holes.reduce((sum, hole) => sum + shoelaceArea(hole), 0)
            : 0
          const area = Math.max(0, shoelaceArea(n.polygon) - holeArea)
          const payload = {
            distanceMeters: 0,
            areaSqMeters: area,
            units: 'meters' as const,
            areaUnits: 'square_meters' as const,
          }
          return {
            content: [{ type: 'text' as const, text: JSON.stringify(payload) }],
            structuredContent: payload,
          }
        }
        // For non-polygon self, distance is 0 and no area.
        const payload = { distanceMeters: 0, units: 'meters' as const }
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(payload) }],
          structuredContent: payload,
        }
      }

      const nodes = bridge.getNodes()
      const pointOf = (node: AnyNode) => {
        try {
          const point = resolveNodeWorldPoint(node.id, nodes)
          if (point) return point
        } catch (err) {
          const reason = err instanceof Error ? err.message : String(err)
          throwMcpError(
            ErrorCode.InvalidRequest,
            `Cannot derive a world point for ${node.type} ${node.id}: ${reason}`,
          )
        }
        throwMcpError(
          ErrorCode.InvalidRequest,
          `Cannot derive a world point for ${node.type} ${node.id}`,
        )
      }
      const fromPoint = pointOf(from as AnyNode)
      const toPoint = pointOf(to as AnyNode)

      const dx = fromPoint[0] - toPoint[0]
      const dy = fromPoint[1] - toPoint[1]
      const dz = fromPoint[2] - toPoint[2]
      const distance = Math.sqrt(dx * dx + dy * dy + dz * dz)

      const payload = {
        distanceMeters: distance,
        fromPoint,
        toPoint,
        units: 'meters' as const,
      }
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(payload) }],
        structuredContent: payload,
      }
    },
  )
}

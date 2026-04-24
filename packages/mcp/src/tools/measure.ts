import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { AnyNode, AnyNodeId } from '@pascal-app/core/schema'
import { z } from 'zod'
import type { SceneBridge } from '../bridge/scene-bridge'
import { ErrorCode, throwMcpError } from './errors'
import { NodeIdSchema } from './schemas'

export const measureInput = {
  fromId: NodeIdSchema,
  toId: NodeIdSchema,
}

export const measureOutput = {
  distanceMeters: z.number(),
  areaSqMeters: z.number().optional(),
  units: z.literal('meters'),
}

/**
 * Compute a 3D centre point in level-coordinate space for distance measurement.
 *
 * For walls / fences: midpoint of the start/end segment at Y=0.
 * For positioned nodes (item, door, window, building, stair, roof): `position`.
 * For polygon nodes (slab, ceiling, zone): 2D centroid lifted to Y=0.
 * For site: centroid of property line at Y=0 if available.
 *
 * Returns null if no representative centre can be derived (e.g. level node
 * has no position of its own).
 */
function getCentre(node: AnyNode): [number, number, number] | null {
  switch (node.type) {
    case 'wall':
    case 'fence': {
      const [x1, z1] = node.start
      const [x2, z2] = node.end
      return [(x1 + x2) / 2, 0, (z1 + z2) / 2]
    }
    case 'item':
    case 'door':
    case 'window':
    case 'building':
    case 'stair':
    case 'roof':
      return node.position
    case 'slab':
    case 'ceiling':
    case 'zone': {
      const poly = node.polygon as Array<[number, number]> | undefined
      if (!poly || poly.length === 0) return null
      let cx = 0
      let cz = 0
      for (const [x, z] of poly) {
        cx += x
        cz += z
      }
      return [cx / poly.length, 0, cz / poly.length]
    }
    case 'site': {
      const pts = node.polygon?.points ?? []
      if (pts.length === 0) return [0, 0, 0]
      let cx = 0
      let cz = 0
      for (const [x, z] of pts) {
        cx += x
        cz += z
      }
      return [cx / pts.length, 0, cz / pts.length]
    }
    default:
      return null
  }
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

export function registerMeasure(server: McpServer, bridge: SceneBridge): void {
  server.registerTool(
    'measure',
    {
      title: 'Measure',
      description:
        'Measure distance (in meters) between two nodes, or the area of a polygon node when fromId === toId.',
      inputSchema: measureInput,
      outputSchema: measureOutput,
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
          const area = shoelaceArea(n.polygon as Array<[number, number]>)
          const payload = {
            distanceMeters: 0,
            areaSqMeters: area,
            units: 'meters' as const,
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

      const fromCentre = getCentre(from as AnyNode)
      const toCentre = getCentre(to as AnyNode)
      if (!fromCentre || !toCentre) {
        throwMcpError(
          ErrorCode.InvalidRequest,
          `Cannot derive centre for measurement between ${from.type} and ${to.type}`,
        )
      }

      const dx = fromCentre[0] - toCentre[0]
      const dy = fromCentre[1] - toCentre[1]
      const dz = fromCentre[2] - toCentre[2]
      const distance = Math.sqrt(dx * dx + dy * dy + dz * dz)

      const payload = {
        distanceMeters: distance,
        units: 'meters' as const,
      }
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(payload) }],
        structuredContent: payload,
      }
    },
  )
}

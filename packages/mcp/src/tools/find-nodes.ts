import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { measurementCentroid, nodeRegistry } from '@pascal-app/core'
import { type Frame, nodeLevelFrame, transformPoint } from '@pascal-app/core/procedural-items'
import { AnyNode, type AnyNodeId, type AnyNodeType, nodeKindOf } from '@pascal-app/core/schema'
import { pointInPolygon } from '@pascal-app/core/spatial-grid'
import { z } from 'zod'
import type { SceneOperations } from '../operations'
import { READ_ONLY_TOOL_ANNOTATIONS } from './annotations'
import { ErrorCode, throwMcpError } from './errors'
import { NodeIdSchema } from './schemas'

const CORE_NODE_KINDS = AnyNode.options.map(nodeKindOf)

export const findNodesInput = {
  type: z
    .string()
    .min(1)
    .optional()
    .describe(
      `Node kind: a core kind (${CORE_NODE_KINDS.join(', ')}) or a plugin kind such as "fixture:bench".`,
    ),
  parentId: NodeIdSchema.optional(),
  levelId: NodeIdSchema.optional(),
  zoneId: NodeIdSchema.optional(),
  sourceId: z
    .string()
    .min(1)
    .optional()
    .describe('Exact match on any entry of node.metadata.sourceIds (the import source ids).'),
  sourceIdPrefix: z
    .string()
    .min(1)
    .optional()
    .describe('Prefix match on any entry of node.metadata.sourceIds.'),
}

export const findNodesOutput = {
  nodes: z.array(z.record(z.string(), z.unknown())),
}

function nodeSourceIds(node: AnyNode): string[] {
  const sourceIds = node.metadata?.sourceIds
  return Array.isArray(sourceIds)
    ? sourceIds.filter((id): id is string => typeof id === 'string')
    : []
}

type Vec3 = [number, number, number]

function centre(points: ReadonlyArray<readonly [number, number]>): [number, number] | null {
  if (points.length === 0) return null
  const area = measurementCentroid(points.map(([x, z]) => [x, 0, z] as [number, number, number]))
  if (area) return [area[0], area[2]]
  let cx = 0
  let cz = 0
  for (const [x, z] of points) {
    cx += x
    cz += z
  }
  return [cx / points.length, cz / points.length]
}

function boundsCentre3(points: ReadonlyArray<readonly [number, number, number]>): Vec3 | null {
  if (points.length === 0) return null
  const centre: Vec3 = [0, 0, 0]
  for (let axis = 0; axis < 3; axis++) {
    const values = points.map((p) => p[axis]!)
    centre[axis] = (Math.min(...values) + Math.max(...values)) / 2
  }
  return centre
}

/**
 * The node's plan point in its level's frame, for zone filtering: a polygon's
 * area centroid, a segment's midpoint, a path's centre, or the origin of a
 * positioned node resolved through its hosts by core's `nodeLevelFrame` (a
 * window in its wall, a module in its cabinet); blocks and imported meshes
 * use their vertex-bounds centre, transformed in 3D before projecting.
 * Frames are plan-only (no slab support or floor lift, which only move
 * heights) and `frames` is shared across one query, so each host resolves once.
 */
function levelPlanPoint(
  node: AnyNode,
  nodes: Record<string, AnyNode>,
  frames: Map<string, Frame>,
): [number, number] | null {
  const n = node as Record<string, unknown>
  if (Array.isArray(n.polygon)) return centre(n.polygon as Array<[number, number]>)
  if (Array.isArray(n.start) && Array.isArray(n.end)) {
    const [x1, z1] = n.start as [number, number]
    const [x2, z2] = n.end as [number, number]
    return [(x1 + x2) / 2, (z1 + z2) / 2]
  }
  if (Array.isArray(n.path)) {
    const path = boundsCentre3(n.path as Array<[number, number, number]>)
    return path ? [path[0], path[2]] : null
  }
  if (!Array.isArray(n.position)) return null
  let frame: Frame
  try {
    frame = nodeLevelFrame(node.id, nodes, undefined, { cache: frames, planOnly: true })
  } catch {
    return null
  }
  const local =
    node.type === 'block'
      ? boundsCentre3(node.topology.vertices.map((v) => v.position as Vec3))
      : node.type === 'imported-mesh'
        ? boundsCentre3(
            node.primitives.flatMap((primitive) => {
              const out: Vec3[] = []
              for (let i = 0; i + 2 < primitive.positions.length; i += 3) {
                out.push([
                  primitive.positions[i]!,
                  primitive.positions[i + 1]!,
                  primitive.positions[i + 2]!,
                ])
              }
              return out
            }),
          )
        : null
  const [x, , z] = transformPoint(frame, local ?? [0, 0, 0])
  return [x, z]
}

/** Node kinds `type` accepts: core kinds, registered plugin kinds, and kinds in the scene. */
function knownNodeKinds(nodes: Record<string, AnyNode>): Set<string> {
  const kinds = new Set<string>(CORE_NODE_KINDS)
  for (const node of Object.values(nodes)) kinds.add(node.type)
  return kinds
}

export function registerFindNodes(server: McpServer, bridge: SceneOperations): void {
  server.registerTool(
    'find_nodes',
    {
      title: 'Find nodes',
      description:
        'Find nodes matching any combination of type, parentId, levelId, zoneId, sourceId or sourceIdPrefix filters. sourceId / sourceIdPrefix match node.metadata.sourceIds, the ids an importer recorded for the source elements.',
      inputSchema: findNodesInput,
      outputSchema: findNodesOutput,
      annotations: READ_ONLY_TOOL_ANNOTATIONS,
    },
    async (args) => {
      const { type, parentId, levelId, zoneId, sourceId, sourceIdPrefix } = args as {
        type?: string
        parentId?: string
        levelId?: string
        zoneId?: string
        sourceId?: string
        sourceIdPrefix?: string
      }

      // Delegate type/parent/level filtering to the bridge.
      const baseFilter: {
        type?: AnyNodeType
        parentId?: AnyNodeId
        levelId?: AnyNodeId
      } = {}
      if (type !== undefined) {
        if (!(knownNodeKinds(bridge.getNodes()).has(type) || nodeRegistry.get(type))) {
          throwMcpError(
            ErrorCode.InvalidParams,
            `unknown node type "${type}": not a core kind, a registered plugin kind or a kind in this scene`,
          )
        }
        baseFilter.type = type as AnyNodeType
      }
      if (parentId !== undefined) baseFilter.parentId = parentId as AnyNodeId
      if (levelId !== undefined) baseFilter.levelId = levelId as AnyNodeId
      let results = bridge.findNodes(baseFilter)

      if (sourceId !== undefined || sourceIdPrefix !== undefined) {
        results = results.filter((n) => {
          const ids = nodeSourceIds(n)
          if (sourceId !== undefined && !ids.includes(sourceId)) return false
          if (sourceIdPrefix !== undefined && !ids.some((id) => id.startsWith(sourceIdPrefix))) {
            return false
          }
          return true
        })
      }

      // Zone filter: nodes on the zone's level whose level-frame plan point
      // falls inside the zone polygon.
      if (zoneId) {
        const zone = bridge.getNode(zoneId as AnyNodeId)
        if (zone?.type !== 'zone') {
          // Unknown zoneId → return empty list rather than throw; matches
          // typical "filter" semantics.
          results = []
        } else {
          const nodes = bridge.getNodes()
          const frames = new Map<string, Frame>()
          const zoneLevelId = bridge.resolveLevelId(zone.id as AnyNodeId)
          results = results.filter((n) => {
            if (bridge.resolveLevelId(n.id as AnyNodeId) !== zoneLevelId) return false
            const pt = levelPlanPoint(n, nodes, frames)
            return pt !== null && pointInPolygon(pt[0], pt[1], zone.polygon)
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

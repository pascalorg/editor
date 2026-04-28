import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { AnyNode, SlabNode, WallNode } from '@pascal-app/core/schema'
import { getWallPlanFootprint } from '@pascal-app/core/wall'
import type { SceneOperations } from '../operations'

type WallFootprint = {
  wallId: string
  footprint: Array<[number, number]>
}

type ConstraintsPayload = {
  levelId: string
  slabs: SlabNode[]
  wallPolygons: WallFootprint[]
}

type ConstraintsError = {
  error: 'level_not_found'
  levelId: string
  slabs: never[]
  wallPolygons: never[]
}

/**
 * Empty `WallMiterData` — we don't compute junctions here. The footprint
 * falls back to a simple rectangle based on start/end + thickness, which is
 * correct for non-intersecting walls and an acceptable approximation for
 * constraint hints.
 *
 * Typed via `Parameters<typeof getWallPlanFootprint>[1]` to avoid `any` and
 * to stay in sync with the core signature.
 */
const EMPTY_MITER_DATA: Parameters<typeof getWallPlanFootprint>[1] = {
  junctionData: new Map(),
  junctions: new Map(),
}

function buildPayload(
  bridge: SceneOperations,
  levelId: string,
): ConstraintsPayload | ConstraintsError {
  const level = bridge.getNode(levelId as never)
  if (!level || level.type !== 'level') {
    return {
      error: 'level_not_found',
      levelId,
      slabs: [] as never[],
      wallPolygons: [] as never[],
    }
  }

  const all = bridge.findNodes({ levelId: levelId as never })
  const slabs: SlabNode[] = []
  const walls: WallNode[] = []
  for (const n of all as AnyNode[]) {
    if (n.type === 'slab') slabs.push(n as SlabNode)
    else if (n.type === 'wall') walls.push(n as WallNode)
  }

  const wallPolygons: WallFootprint[] = []
  for (const wall of walls) {
    const points = getWallPlanFootprint(wall, EMPTY_MITER_DATA)
    wallPolygons.push({
      wallId: wall.id,
      footprint: points.map((p) => [p.x, p.y] as [number, number]),
    })
  }

  return { levelId, slabs, wallPolygons }
}

/**
 * `pascal://constraints/{levelId}` — per-level geometric constraints used as
 * input hints for agents: slab nodes (with polygons/holes/elevation) + each
 * wall's plan-view footprint polygon.
 */
export function registerConstraints(server: McpServer, bridge: SceneOperations): void {
  server.registerResource(
    'constraints',
    new ResourceTemplate('pascal://constraints/{levelId}', { list: undefined }),
    {
      title: 'Level constraints',
      description:
        'Per-level constraints: slab nodes and wall plan footprints. Returns {error:"level_not_found"} if the level id is unknown.',
      mimeType: 'application/json',
    },
    async (uri, variables) => {
      const rawLevelId = variables.levelId
      const levelId = Array.isArray(rawLevelId) ? rawLevelId[0] : rawLevelId
      const payload = buildPayload(bridge, levelId ?? '')
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: 'application/json',
            text: JSON.stringify(payload),
          },
        ],
      }
    },
  )
}

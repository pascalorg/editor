import {
  type AnyNodeId,
  type HandleDescriptor,
  type NodeDefinition,
  RoofNode as RoofNodeSchema,
  type RoofNode as RoofNodeType,
  type RoofSegmentNode,
  type SceneApi,
} from '@pascal-app/core'
import { buildRoofFloorplan } from './floorplan'
import { roofParametrics } from './parametrics'
import { RoofNode } from './schema'

const MOVE_FRONT_OFFSET = 0.35
const MIN_ROOF_FOOTPRINT = 1

type RoofFootprintBounds = {
  maxX: number
  maxZ: number
  minX: number
  minZ: number
}

function getRoofFootprintBounds(node: RoofNodeType, sceneApi: SceneApi): RoofFootprintBounds {
  let bounds: RoofFootprintBounds | null = null

  for (const childId of node.children ?? []) {
    const segment = sceneApi.get<RoofSegmentNode>(childId as AnyNodeId)
    if (segment?.type !== 'roof-segment') continue

    const halfWidth = Math.max(segment.width, MIN_ROOF_FOOTPRINT) / 2
    const halfDepth = Math.max(segment.depth, MIN_ROOF_FOOTPRINT) / 2
    const cos = Math.cos(segment.rotation ?? 0)
    const sin = Math.sin(segment.rotation ?? 0)
    const corners = [
      [-halfWidth, -halfDepth],
      [halfWidth, -halfDepth],
      [halfWidth, halfDepth],
      [-halfWidth, halfDepth],
    ] as const

    for (const [x, z] of corners) {
      const localX = segment.position[0] + x * cos + z * sin
      const localZ = segment.position[2] - x * sin + z * cos
      bounds =
        bounds === null
          ? { maxX: localX, maxZ: localZ, minX: localX, minZ: localZ }
          : {
              maxX: Math.max(bounds.maxX, localX),
              maxZ: Math.max(bounds.maxZ, localZ),
              minX: Math.min(bounds.minX, localX),
              minZ: Math.min(bounds.minZ, localZ),
            }
    }
  }

  return bounds ?? { maxX: 0.5, maxZ: 0.5, minX: -0.5, minZ: -0.5 }
}

function roofMoveHandle(): HandleDescriptor<RoofNodeType> {
  return {
    kind: 'translate',
    placement: {
      position: (node, sceneApi) => {
        const bounds = getRoofFootprintBounds(node, sceneApi)
        return [(bounds.minX + bounds.maxX) / 2, 0.02, bounds.maxZ + MOVE_FRONT_OFFSET]
      },
    },
    apply: (_node, position) => ({ position: [position[0], position[1], position[2]] }),
    snapExtents: (node, sceneApi) => {
      const bounds = getRoofFootprintBounds(node, sceneApi)
      const width = Math.max(bounds.maxX - bounds.minX, MIN_ROOF_FOOTPRINT)
      const depth = Math.max(bounds.maxZ - bounds.minZ, MIN_ROOF_FOOTPRINT)
      const swap = Math.abs(Math.sin(node.rotation ?? 0)) > 0.9
      return [swap ? depth : width, swap ? width : depth]
    },
  }
}

const roofHandles: HandleDescriptor<RoofNodeType>[] = [roofMoveHandle()]

/**
 * Roof — Stage A registration. Wrap-exports the legacy `RoofRenderer`
 * + `RoofSystem` (geometry generation via `getRoofSegmentBrushes` +
 * CSG). Inspector / move stay legacy until Stage B-E. `floorplan` draws
 * the merged silhouette (union of the child segments' footprints), so a
 * multi-segment roof reads as one combined shape rather than stacked
 * rectangles.
 *
 * Roof is a "composite" node — it has `roof-segment` children that
 * own per-segment geometry. The parent roof handles overall framing;
 * each segment is its own registered kind (see `roof-segment`).
 */
export const roofDefinition: NodeDefinition<typeof RoofNode> = {
  kind: 'roof',
  schemaVersion: 1,
  schema: RoofNode,
  category: 'structure',
  surfaceRole: 'roof',

  defaults: () => {
    const stub = RoofNodeSchema.parse({ id: 'roof_default' as never, type: 'roof' })
    const { id: _id, type: _type, ...rest } = stub
    return rest
  },

  capabilities: {
    selectable: { hitVolume: 'bbox' },
    duplicable: true,
    deletable: true,
  },

  // Bespoke free-floating move (drag-to-place with R/T rotation and
  // wall/fence snapping). Routes through `MoveTool`'s registry-affordance
  // lookup — no hardcoded dispatcher arm. Shared with roof-segment / stair
  // / stair-segment via `shared/move-roof-tool`.
  affordanceTools: {
    move: () => import('../shared/move-roof-tool'),
  },

  parametrics: roofParametrics,
  handles: roofHandles,
  floorplan: buildRoofFloorplan,

  renderer: {
    kind: 'parametric',
    module: () => import('./renderer'),
  },
  system: {
    module: () => import('./system'),
    priority: 3,
  },

  presentation: {
    label: 'Roof',
    description: 'A pitched / hip / gable roof composed of one or more segments.',
    icon: { kind: 'url', src: '/icons/roof.png' },
    paletteSection: 'structure',
    paletteOrder: 100,
  },

  mcp: {
    description: 'A roof composed of segmented planes (gable / hip / shed).',
  },
}

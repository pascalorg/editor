import { type NodeDefinition, ZoneNode as ZoneNodeSchema } from '@pascal-app/core'
import { buildZoneFloorplan } from './floorplan'
import {
  zoneAddVertexAffordance,
  zoneMoveEdgeAffordance,
  zoneMoveVertexAffordance,
} from './floorplan-affordances'
import { zoneFloorplanMoveTarget } from './floorplan-move'
import { zoneParametrics } from './parametrics'
import { ZoneNode } from './schema'

/**
 * Zone — Stage A. Custom-behavior escape hatch: zone uses TSL shader
 * materials + `<Html>` portals + per-frame uniform poking, so it
 * lives via `def.renderer` + `def.system` (no `def.geometry` possible
 * because zone isn't really a mesh).
 */
export const zoneDefinition: NodeDefinition<typeof ZoneNode> = {
  kind: 'zone',
  snapProfile: 'structural',
  schemaVersion: 1,
  schema: ZoneNode,
  category: 'site',

  defaults: () => {
    const stub = ZoneNodeSchema.parse({ id: 'zone_default' as never, type: 'zone' })
    const { id: _id, type: _type, ...rest } = stub
    return rest
  },

  capabilities: {
    selectable: { hitVolume: 'bbox' },
    duplicable: true,
    deletable: true,
    // Zones describe regions of a site — they don't translate as
    // reusable presets independent of their site context.
    presettable: false,
  },

  parametrics: zoneParametrics,
  // No dirty consumer rebuilds this kind — see NodeDefinition.dirtyTracking.
  dirtyTracking: false,

  renderer: {
    kind: 'parametric',
    module: () => import('./renderer'),
  },
  system: {
    module: () => import('./system'),
    priority: 4,
  },
  floorplan: buildZoneFloorplan,
  // 2D body move — centroid-pivot polygon mover (same as slab / ceiling).
  // Without this, zone fell through to the overlay's generic free-translate
  // path, which committed a `position` field zone has no schema for, so the
  // polygon never actually moved on drop.
  floorplanMoveTarget: zoneFloorplanMoveTarget,
  // Polygon editor when selected — same three operations slabs / ceilings
  // expose. The shared factories key off `node.polygon`, optional
  // `node.holes` (absent on zones). See `floorplan-affordances.ts`.
  floorplanAffordances: {
    'move-vertex': zoneMoveVertexAffordance,
    'add-vertex': zoneAddVertexAffordance,
    'move-edge': zoneMoveEdgeAffordance,
  },

  presentation: {
    label: 'Zone',
    description: 'A polygonal site zone (lawn, water, paving) with a TSL gradient material.',
    icon: { kind: 'url', src: '/icons/zone.webp' },
    paletteSection: 'site',
    paletteOrder: 20,
  },

  mcp: {
    description: 'A polygon-bounded site zone with a typed surface (grass / water / paving / ...).',
  },
}

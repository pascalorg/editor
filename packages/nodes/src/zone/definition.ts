import { type NodeDefinition, ZoneNode as ZoneNodeSchema } from '@pascal-app/core'
import { buildZoneFloorplan } from './floorplan'
import {
  zoneAddVertexAffordance,
  zoneMoveEdgeAffordance,
  zoneMoveVertexAffordance,
} from './floorplan-affordances'
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

  renderer: {
    kind: 'parametric',
    module: () => import('./renderer'),
  },
  system: {
    module: () => import('./system'),
    priority: 4,
  },
  floorplan: buildZoneFloorplan,
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
    icon: { kind: 'url', src: '/icons/zone.png' },
    paletteSection: 'site',
    paletteOrder: 20,
  },

  mcp: {
    description: 'A polygon-bounded site zone with a typed surface (grass / water / paving / ...).',
  },
}

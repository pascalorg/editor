import { ZoneNode as ZoneNodeSchema } from '@pascal-app/core'
import type { NodeRenderDefinition } from '../definition-contributions'
import { polygonMeasurementFeatures } from '../shared/polygon-measurement'
import { buildZoneFloorplan } from './floorplan'
import { zoneQuickMeasurement } from './quick-measurement'
import { ZoneNode } from './schema'

export const zoneRenderDefinition: NodeRenderDefinition<typeof ZoneNode> & { kind: 'zone' } = {
  kind: 'zone',
  schemaVersion: 2,
  schema: ZoneNode,
  category: 'site',
  defaults: () => {
    const stub = ZoneNodeSchema.parse({ id: 'zone_default' as never, type: 'zone' })
    const { id: _id, type: _type, ...rest } = stub
    return rest
  },
  capabilities: {
    selectable: { hitVolume: 'bbox' },
    exterior: false,
    revealLayout: { room: (node) => (node.type === 'zone' ? node.polygon : null) },
    duplicable: true,
    deletable: true,
    // Zones describe regions of a site — they don't translate as
    // reusable presets independent of their site context.
    presettable: false,
  },
  measurement: {
    features: (node, ctx) =>
      polygonMeasurementFeatures({
        featurePrefix: 'zone',
        height: 0,
        label: 'Zone',
        polygon: node.polygon,
      }),
    quickMeasure: (node) => zoneQuickMeasurement(node),
  },
  // No dirty consumer rebuilds this kind — see NodeDefinition.dirtyTracking.
  dirtyTracking: false,
  rendersChildren: false,
  renderer: {
    kind: 'parametric',
    module: () => import('./renderer'),
  },
  system: {
    module: () => import('./system'),
    priority: 4,
  },
  floorplan: buildZoneFloorplan,
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

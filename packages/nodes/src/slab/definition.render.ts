import {
  liftedManualSlab,
  pointInPolygon2D,
  type SlabNode as SlabNodeType,
  slabSlots,
} from '@pascal-app/core'
import type { NodeRenderDefinition } from '../definition-contributions'
import { surfaceBatchable } from '../shared/node-batch/batchable'
import { polygonMeasurementFeatures } from '../shared/polygon-measurement'
import { buildSlabFloorplan } from './floorplan'
import { buildSlabGeometry } from './geometry'
import { slabQuickMeasurement } from './quick-measurement'
import { SlabNode } from './schema'

export const slabRenderDefinition: NodeRenderDefinition<typeof SlabNode> & { kind: 'slab' } = {
  kind: 'slab',
  schemaVersion: 1,
  schema: SlabNode,
  category: 'structure',
  surfaceRole: 'floor',
  defaults: () => ({
    object: 'node',
    parentId: null,
    visible: true,
    metadata: {},
    polygon: [],
    holes: [],
    holeMetadata: [],
    elevation: 0.05,
    thickness: 0.05,
    recessed: false,
    autoFromWalls: false,
  }),
  capabilities: {
    reveal: { phase: 'foundation', style: 'settle', height: 0.08 },
    revealOnEdit: [
      'polygon',
      'holes',
      'elevation',
      'thickness',
      'recessed',
      'recessedRimElevation',
    ],
    batchable: surfaceBatchable,
    selectable: { hitVolume: 'bbox' },
    surfaces: {
      top: {
        height: (n) => (n as SlabNode).elevation,
        supportHeight: (node, x, z, context) => {
          const slab = node as SlabNodeType
          if (
            slab.polygon.length < 3 ||
            !pointInPolygon2D([x, z], slab.polygon, { includeBoundary: true }) ||
            slab.holes.some(
              (hole) =>
                hole.length >= 3 && pointInPolygon2D([x, z], hole, { includeBoundary: false }),
            )
          )
            return null
          return liftedManualSlab(context.nodes, slab).elevation
        },
      },
    },
    duplicable: true,
    deletable: true,
    // Unified slot model: one paintable floor surface with a declared default,
    // painted through the registry `capabilities.paint` dispatch like the shelf.
    slots: () => slabSlots(),
  },
  relations: {
    hosts: ['item'],
    cascadeDelete: 'descendants',
  },
  measurement: {
    features: (node) =>
      polygonMeasurementFeatures({
        featurePrefix: 'slab',
        height: node.elevation,
        label: 'Slab',
        polygon: node.polygon,
      }),
    quickMeasure: (node) => slabQuickMeasurement(node),
  },
  renderer: {
    kind: 'parametric',
    module: () => import('./renderer'),
  },
  // Stage B: pure geometry function.
  geometry: buildSlabGeometry,
  // Dependency tracker only — dirties level slabs when walls / sibling
  // slabs change, since the renderable polygon derives from level context.
  system: {
    module: () => import('./system'),
    priority: 4,
  },
  // Stage C: floor-plan rendering. Legacy `slabPolygons` short-circuits
  // to [] when slab is registered (see floorplan-panel.tsx).
  floorplan: buildSlabFloorplan,
  presentation: {
    label: 'Slab',
    description: 'A polygon-bounded floor surface that hosts items on top.',
    icon: { kind: 'url', src: '/icons/floor.webp' },
    paletteSection: 'structure',
    paletteOrder: 30,
  },
  mcp: {
    description: 'A polygon-bounded slab (floor) with optional cutout holes.',
  },
}

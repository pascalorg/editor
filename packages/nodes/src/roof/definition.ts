import { type NodeDefinition, RoofNode as RoofNodeSchema } from '@pascal-app/core'
import { buildRoofFloorplan } from './floorplan'
import { roofParametrics } from './parametrics'
import { RoofNode } from './schema'

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

  parametrics: roofParametrics,
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

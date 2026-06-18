import { type NodeDefinition, RoofNode as RoofNodeSchema } from '@pascal-app/core'
import { roofSurfaceMaterialTargets } from '../shared/material-targets'
import { roofParametrics } from './parametrics'
import { RoofNode } from './schema'

/**
 * Roof — Stage A registration. Wrap-exports the legacy `RoofRenderer`
 * + `RoofSystem` (geometry generation via `getRoofSegmentBrushes` +
 * CSG). Inspector / move / floorplan stay legacy until Stage B-E.
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

  materialTargets: roofSurfaceMaterialTargets,

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
    icon: { kind: 'url', src: '/icons/roof.webp' },
    paletteSection: 'structure',
    paletteOrder: 100,
  },

  mcp: {
    description: 'A roof composed of segmented planes (gable / hip / shed).',
  },
}

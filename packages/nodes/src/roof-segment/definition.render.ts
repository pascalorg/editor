import {
  RoofSegmentNode as RoofSegmentNodeSchema,
  type RoofSegmentNode as RoofSegmentNodeType,
} from '@pascal-app/core'
import type { NodeRenderDefinition } from '../definition-contributions'
import { buildRoofSegmentFloorplan } from './floorplan'
import { matchRoofSegmentMeasurementFeature, roofSegmentMeasurementFeatures } from './measurement'
import { RoofSegmentNode } from './schema'
import { roofSegmentSlots } from './slots'

export const roofSegmentRenderDefinition: NodeRenderDefinition<typeof RoofSegmentNode> & {
  kind: 'roof-segment'
} = {
  kind: 'roof-segment',
  schemaVersion: 7,
  schema: RoofSegmentNode,
  category: 'structure',
  surfaceRole: 'roof',
  defaults: () => {
    const stub = RoofSegmentNodeSchema.parse({
      id: 'roof-segment_default' as never,
      type: 'roof-segment',
    })
    const { id: _id, type: _type, ...rest } = stub
    return rest
  },
  capabilities: {
    exterior: true,
    revealOnEdit: [
      'roofType',
      'width',
      'depth',
      'wallHeight',
      'pitch',
      'overhang',
      'wallThickness',
      'deckThickness',
      'barrelRise',
      'barrelSegments',
      'roofSystem',
      'glazing',
    ],
    slots: (node) => roofSegmentSlots(node as RoofSegmentNodeType),
    selectable: { hitVolume: 'bbox' },
    duplicable: true,
    deletable: true,
  },
  rendersChildren: false,
  renderer: {
    kind: 'parametric',
    module: () => import('./renderer'),
  },
  measurement: {
    features: (node, ctx) =>
      roofSegmentMeasurementFeatures(node, ctx.parent?.type === 'roof' ? ctx.parent : null),
    match: (node, ctx, point, maxDistance) =>
      matchRoofSegmentMeasurementFeature(
        node,
        ctx.parent?.type === 'roof' ? ctx.parent : null,
        point,
        maxDistance,
      ),
  },
  floorplan: buildRoofSegmentFloorplan,
  presentation: {
    label: 'Roof Segment',
    description: 'A single pitched plane of a parent roof.',
    icon: { kind: 'url', src: '/icons/roof.webp' },
    paletteSection: 'structure',
    paletteOrder: 101,
  },
  mcp: {
    description: 'A single roof segment with polygon footprint + pitch.',
  },
}

import { StairSegmentNode as StairSegmentNodeSchema, stairSegmentSlots } from '@pascal-app/core'
import type { NodeRenderDefinition } from '../definition-contributions'
import { StairSegmentNode } from './schema'

export const stairSegmentRenderDefinition: NodeRenderDefinition<typeof StairSegmentNode> & {
  kind: 'stair-segment'
} = {
  kind: 'stair-segment',
  schemaVersion: 2,
  schema: StairSegmentNode,
  category: 'structure',
  surfaceRole: 'joinery',
  defaults: () => {
    const stub = StairSegmentNodeSchema.parse({
      id: 'stair-segment_default' as never,
      type: 'stair-segment',
    })
    const { id: _id, type: _type, ...rest } = stub
    return rest
  },
  capabilities: {
    selectable: { hitVolume: 'bbox' },
    duplicable: false,
    deletable: true,
    slots: stairSegmentSlots,
  },
  rendersChildren: false,
  renderer: {
    kind: 'parametric',
    module: () => import('./renderer'),
  },
  presentation: {
    label: 'Stair Segment',
    description: 'A single flight of a parent stair.',
    icon: { kind: 'url', src: '/icons/stairs.webp' },
    paletteSection: 'structure',
    paletteOrder: 111,
  },
  mcp: {
    description:
      'A straight flight, landing or quarter-turn winder. Winders use an inner gap, walking-line offset and equal-going or equal-angle division; length applies only to straight flights.',
  },
}

import { MeasurementNode as MeasurementNodeSchema, type NodeDefinition } from '@pascal-app/core'
import { MeasurementNode } from './schema'

export const measurementDefinition: NodeDefinition<typeof MeasurementNode> = {
  kind: 'measurement',
  bake: 'strip',
  schemaVersion: 1,
  schema: MeasurementNode,
  category: 'site',
  defaults: () => {
    const stub = MeasurementNodeSchema.parse({
      id: 'measurement_default',
      measurementId: 'measurement_default',
      start: [0, 0, 0],
      end: [1, 0, 0],
      view: '3d',
    })
    const { id: _id, type: _type, ...rest } = stub
    return rest
  },
  capabilities: {
    deletable: true,
    duplicable: false,
    presettable: false,
  },
  dirtyTracking: false,
  presentation: {
    label: 'Measurement',
    description: 'A linear dimension attached to scene geometry.',
    icon: { kind: 'url', src: '/icons/blueprint.webp' },
    paletteSection: 'site',
    paletteOrder: 31,
  },
  mcp: {
    description: 'A linear dimension attached to scene geometry.',
  },
}

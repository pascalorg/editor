import type { ParametricDescriptor } from '@pascal-app/core'
import type { ElectricalConduitNode } from './schema'

export const electricalConduitParametrics: ParametricDescriptor<ElectricalConduitNode> = {
  groups: [
    {
      label: 'Electrical',
      fields: [
        {
          key: 'system',
          kind: 'enum',
          options: ['power', 'lighting', 'data'],
          display: 'segmented',
        },
        {
          key: 'diameter',
          kind: 'number',
          unit: 'in',
          min: 0.5,
          max: 4,
          step: 0.25,
        },
      ],
    },
    {
      label: 'Construction',
      fields: [
        {
          key: 'conduitMaterial',
          kind: 'enum',
          options: ['emt', 'pvc', 'flex'],
        },
      ],
    },
  ],
}

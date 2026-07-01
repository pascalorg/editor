import type { ParametricDescriptor } from '@pascal-app/core'
import type { WaterLineNode } from './schema'

export const waterLineParametrics: ParametricDescriptor<WaterLineNode> = {
  groups: [
    {
      label: 'Supply',
      fields: [
        {
          key: 'system',
          kind: 'enum',
          options: ['cold-water', 'hot-water'],
          display: 'segmented',
        },
        {
          key: 'diameter',
          kind: 'number',
          unit: 'in',
          min: 0.25,
          max: 4,
          step: 0.25,
        },
      ],
    },
    {
      label: 'Construction',
      fields: [
        {
          key: 'pipeMaterial',
          kind: 'enum',
          options: ['pex', 'copper', 'cpvc', 'pvc'],
        },
      ],
    },
  ],
}

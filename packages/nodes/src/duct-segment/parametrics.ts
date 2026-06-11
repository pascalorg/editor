import type { ParametricDescriptor } from '@pascal-app/core'
import type { DuctSegmentNode } from './schema'

export const ductSegmentParametrics: ParametricDescriptor<DuctSegmentNode> = {
  groups: [
    {
      label: 'Air',
      fields: [
        {
          key: 'system',
          kind: 'enum',
          options: ['supply', 'return'],
          display: 'segmented',
        },
        {
          key: 'diameter',
          kind: 'number',
          unit: 'in',
          min: 4,
          max: 24,
          step: 1,
        },
      ],
    },
    {
      label: 'Construction',
      fields: [
        {
          key: 'ductMaterial',
          kind: 'enum',
          options: ['sheet-metal', 'flex', 'duct-board'],
        },
        {
          key: 'insulationR',
          kind: 'number',
          min: 0,
          max: 8,
          step: 0.5,
        },
      ],
    },
  ],
}

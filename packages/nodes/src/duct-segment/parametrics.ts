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
          key: 'shape',
          kind: 'enum',
          options: ['round', 'rect'],
          display: 'segmented',
        },
        {
          key: 'diameter',
          kind: 'number',
          unit: 'in',
          min: 4,
          max: 24,
          step: 1,
          visibleIf: (n) => n.shape !== 'rect',
        },
        {
          key: 'width',
          kind: 'number',
          unit: 'in',
          min: 4,
          max: 60,
          step: 1,
          visibleIf: (n) => n.shape === 'rect',
        },
        {
          key: 'height',
          kind: 'number',
          unit: 'in',
          min: 3,
          max: 40,
          step: 1,
          visibleIf: (n) => n.shape === 'rect',
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

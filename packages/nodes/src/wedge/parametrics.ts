import type { ParametricDescriptor, WedgeNode } from '@pascal-app/core'

export const wedgeParametrics: ParametricDescriptor<WedgeNode> = {
  groups: [
    {
      label: 'Dimensions',
      fields: [
        { key: 'length', kind: 'number', min: 0.01, max: 50, step: 0.05, unit: 'm' },
        { key: 'width', kind: 'number', min: 0.01, max: 50, step: 0.05, unit: 'm' },
        { key: 'height', kind: 'number', min: 0.01, max: 20, step: 0.05, unit: 'm' },
        { key: 'slopeAxis', kind: 'enum', options: ['x', 'z'], display: 'segmented' },
        {
          key: 'slopeDirection',
          kind: 'enum',
          options: ['positive', 'negative'],
          display: 'segmented',
        },
      ],
    },
  ],
}

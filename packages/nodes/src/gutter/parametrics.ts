import type { ParametricDescriptor } from '@pascal-app/core'
import type { GutterNode } from './schema'

export const gutterParametrics: ParametricDescriptor<GutterNode> = {
  groups: [
    {
      label: 'Profile',
      fields: [
        {
          key: 'profile',
          kind: 'enum',
          options: ['k-style', 'half-round', 'box'],
          display: 'segmented',
        },
      ],
    },
    {
      label: 'Dimensions',
      fields: [
        { key: 'length', kind: 'number', unit: 'm', min: 0.2, max: 12, step: 0.05 },
        { key: 'size', kind: 'number', unit: 'm', min: 0.05, max: 0.3, step: 0.005 },
        {
          key: 'thickness',
          kind: 'number',
          unit: 'm',
          min: 0.001,
          max: 0.02,
          step: 0.001,
        },
      ],
    },
    {
      label: 'End caps',
      fields: [
        { key: 'endCapLeft', kind: 'boolean' },
        { key: 'endCapRight', kind: 'boolean' },
      ],
    },
  ],
}

import type { ParametricDescriptor, TankNode } from '@pascal-app/core'

export const tankParametrics: ParametricDescriptor<TankNode> = {
  groups: [
    {
      label: 'Tank',
      fields: [
        {
          key: 'kind',
          kind: 'enum',
          options: ['vertical', 'horizontal', 'spherical'],
          display: 'segmented',
        },
        { key: 'liquidLevel', kind: 'number', min: 0, max: 1, step: 0.01 },
      ],
    },
    {
      label: 'Dimensions',
      fields: [
        { key: 'diameter', kind: 'number', unit: 'm', min: 0.1, max: 20, step: 0.1 },
        {
          key: 'height',
          kind: 'number',
          unit: 'm',
          min: 0.1,
          max: 40,
          step: 0.1,
          visibleIf: (node) => node.kind === 'vertical',
        },
        {
          key: 'length',
          kind: 'number',
          unit: 'm',
          min: 0.1,
          max: 40,
          step: 0.1,
          visibleIf: (node) => node.kind === 'horizontal',
        },
      ],
    },
    {
      label: 'Appearance',
      fields: [
        { key: 'shellColor', kind: 'color' },
        { key: 'liquidColor', kind: 'color' },
        { key: 'shellOpacity', kind: 'number', min: 0.05, max: 1, step: 0.05 },
      ],
    },
  ],
  customPanel: () => import('./panel'),
}

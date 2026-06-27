import type { ConveyorBeltNode, ParametricDescriptor } from '@pascal-app/core'

export const conveyorBeltParametrics: ParametricDescriptor<ConveyorBeltNode> = {
  customPanel: () => import('./panel'),
  groups: [
    {
      label: 'Dimensions',
      fields: [
        { key: 'width', kind: 'number', unit: 'm', min: 0.1, max: 5, step: 0.05 },
        { key: 'thickness', kind: 'number', unit: 'm', min: 0.02, max: 0.5, step: 0.01 },
        { key: 'elevation', kind: 'number', unit: 'm', min: -2, max: 20, step: 0.05 },
      ],
    },
    {
      label: 'Rollers',
      fields: [
        { key: 'showRollers', kind: 'boolean' },
        {
          key: 'rollerSpacing',
          kind: 'number',
          unit: 'm',
          min: 0.2,
          max: 5,
          step: 0.05,
          visibleIf: (node) => node.showRollers,
        },
      ],
    },
    {
      label: 'Flow',
      fields: [
        {
          key: 'direction',
          kind: 'enum',
          options: ['forward', 'backward'],
        },
      ],
    },
    {
      label: 'Appearance',
      fields: [
        { key: 'color', kind: 'color' },
        { key: 'edgeColor', kind: 'color' },
        { key: 'rollerColor', kind: 'color' },
        { key: 'showFrame', kind: 'boolean' },
      ],
    },
  ],
}

import type { ParametricDescriptor, SteelBeamNode } from '@pascal-app/core'

export const steelBeamParametrics: ParametricDescriptor<SteelBeamNode> = {
  groups: [
    {
      label: 'Profile',
      fields: [
        {
          key: 'profile',
          kind: 'enum',
          options: ['i-beam', 'box', 'channel', 'concave'],
          display: 'segmented',
        },
      ],
    },
    {
      label: 'Dimensions',
      fields: [
        { key: 'height', kind: 'number', unit: 'm', min: 0.08, max: 2, step: 0.01 },
        { key: 'width', kind: 'number', unit: 'm', min: 0.05, max: 1.2, step: 0.01 },
        { key: 'elevation', kind: 'number', unit: 'm', min: 0, max: 12, step: 0.05 },
        { key: 'curveOffset', kind: 'number', unit: 'm', min: -20, max: 20, step: 0.05 },
        { key: 'flangeThickness', kind: 'number', unit: 'm', min: 0.01, max: 0.2, step: 0.005 },
        { key: 'webThickness', kind: 'number', unit: 'm', min: 0.008, max: 0.2, step: 0.005 },
      ],
    },
    {
      label: 'Appearance',
      fields: [{ key: 'color', kind: 'color' }],
    },
  ],
}

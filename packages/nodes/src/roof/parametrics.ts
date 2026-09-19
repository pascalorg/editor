import type { ParametricDescriptor, RoofNode } from '@pascal-app/core'

export const roofParametrics: ParametricDescriptor<RoofNode> = {
  groups: [
    {
      label: 'Position',
      fields: [
        { key: 'position', kind: 'vec3' },
        {
          key: 'rotation',
          kind: 'number',
          label: 'Rotation (rad)',
          min: -Math.PI,
          max: Math.PI,
          step: Math.PI / 36,
        },
      ],
    },
  ],
  customPanel: () => import('./panel'),
}

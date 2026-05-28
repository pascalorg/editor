import type { CapsuleNode, ParametricDescriptor } from '@pascal-app/core'

export const capsuleParametrics: ParametricDescriptor<CapsuleNode> = {
  groups: [
    {
      label: 'Dimensions',
      fields: [
        { key: 'radius', kind: 'number', min: 0.01, max: 10, step: 0.01, unit: 'm' },
        { key: 'height', kind: 'number', min: 0.02, max: 20, step: 0.05, unit: 'm' },
        { key: 'capSegments', kind: 'number', min: 1, max: 16, step: 1 },
        { key: 'radialSegments', kind: 'number', min: 8, max: 64, step: 1 },
      ],
    },
  ],
}

import type { FrustumNode, ParametricDescriptor } from '@pascal-app/core'

export const frustumParametrics: ParametricDescriptor<FrustumNode> = {
  groups: [
    {
      label: 'Dimensions',
      fields: [
        { key: 'radiusTop', kind: 'number', min: 0.001, max: 10, step: 0.01, unit: 'm' },
        { key: 'radiusBottom', kind: 'number', min: 0.001, max: 10, step: 0.01, unit: 'm' },
        { key: 'height', kind: 'number', min: 0.01, max: 20, step: 0.05, unit: 'm' },
        { key: 'radialSegments', kind: 'number', min: 3, max: 64, step: 1 },
      ],
    },
  ],
}

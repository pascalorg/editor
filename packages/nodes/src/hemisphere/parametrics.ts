import type { HemisphereNode, ParametricDescriptor } from '@pascal-app/core'

export const hemisphereParametrics: ParametricDescriptor<HemisphereNode> = {
  groups: [
    {
      label: 'Dimensions',
      fields: [
        { key: 'radius', kind: 'number', min: 0.01, max: 10, step: 0.01, unit: 'm' },
        { key: 'scale', kind: 'vec3' },
        { key: 'widthSegments', kind: 'number', min: 8, max: 64, step: 1 },
        { key: 'heightSegments', kind: 'number', min: 4, max: 32, step: 1 },
      ],
    },
  ],
}

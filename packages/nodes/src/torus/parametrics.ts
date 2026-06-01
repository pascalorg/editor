import type { ParametricDescriptor, TorusNode } from '@pascal-app/core'

export const torusParametrics: ParametricDescriptor<TorusNode> = {
  groups: [
    {
      label: 'Dimensions',
      fields: [
        { key: 'majorRadius', kind: 'number', min: 0.01, max: 10, step: 0.01, unit: 'm' },
        { key: 'tubeRadius', kind: 'number', min: 0.001, max: 5, step: 0.01, unit: 'm' },
        { key: 'arc', kind: 'number', min: 0.01, max: Math.PI * 2, step: 0.01, unit: 'rad' },
        { key: 'radialSegments', kind: 'number', min: 3, max: 64, step: 1 },
        { key: 'tubularSegments', kind: 'number', min: 8, max: 128, step: 1 },
      ],
    },
  ],
}

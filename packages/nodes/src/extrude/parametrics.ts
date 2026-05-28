import type { ExtrudeNode, ParametricDescriptor } from '@pascal-app/core'

export const extrudeParametrics: ParametricDescriptor<ExtrudeNode> = {
  groups: [
    {
      label: 'Dimensions',
      fields: [
        { key: 'depth', kind: 'number', min: 0.005, max: 10, step: 0.01, unit: 'm' },
        { key: 'bevelSize', kind: 'number', min: 0, max: 1, step: 0.005, unit: 'm' },
        { key: 'bevelThickness', kind: 'number', min: 0, max: 1, step: 0.005, unit: 'm' },
        { key: 'bevelSegments', kind: 'number', min: 0, max: 12, step: 1 },
        { key: 'curveSegments', kind: 'number', min: 1, max: 32, step: 1 },
      ],
    },
  ],
}

import type { ParametricDescriptor, SweepNode } from '@pascal-app/core'

export const sweepParametrics: ParametricDescriptor<SweepNode> = {
  groups: [
    {
      label: 'Dimensions',
      fields: [
        { key: 'radius', kind: 'number', min: 0.005, max: 2, step: 0.005, unit: 'm' },
        { key: 'tubularSegments', kind: 'number', min: 2, max: 128, step: 1 },
        { key: 'radialSegments', kind: 'number', min: 3, max: 32, step: 1 },
        { key: 'closed', kind: 'boolean' },
      ],
    },
  ],
}

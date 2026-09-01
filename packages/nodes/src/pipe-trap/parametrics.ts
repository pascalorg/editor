import type { ParametricDescriptor } from '@pascal-app/core'
import type { PipeTrapNode } from './schema'

export const pipeTrapParametrics: ParametricDescriptor<PipeTrapNode> = {
  groups: [
    {
      label: 'Trap',
      labelKey: 'nodes.pipeTrap.trap',
      fields: [
        { key: 'diameter', kind: 'number', unit: 'in', min: 1.25, max: 4, step: 0.25 },
        { key: 'pipeMaterial', kind: 'enum', options: ['pvc', 'abs', 'cast-iron'] },
        { key: 'armLengthM', kind: 'number', unit: 'm', min: 0, max: 4, step: 0.05 },
      ],
    },
    {
      label: 'Placement',
      labelKey: 'common.placement',
      fields: [{ key: 'position', kind: 'vec3' }],
    },
  ],
}

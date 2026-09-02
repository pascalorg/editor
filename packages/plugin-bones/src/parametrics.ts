import type { ParametricDescriptor } from '@pascal-app/core'
import { LUMBER_ORIENTATIONS, LUMBER_SIZES } from './lumber'
import type { LumberNode } from './schema'

/**
 * The member's right-hand inspector. The host's `ParametricInspector` renders
 * every control from this descriptor with zero Bones-specific editor code.
 */
export const lumberParametrics: ParametricDescriptor<LumberNode> = {
  groups: [
    {
      label: 'Lumber',
      fields: [
        { key: 'size', kind: 'enum', options: [...LUMBER_SIZES] },
        {
          key: 'orientation',
          kind: 'enum',
          options: [...LUMBER_ORIENTATIONS],
          display: 'segmented',
        },
        { key: 'length', kind: 'number', unit: 'm', min: 0.1, max: 7.4, step: 0.05 },
      ],
    },
    {
      label: 'Position',
      fields: [{ key: 'position', kind: 'vec3' }],
    },
  ],
}

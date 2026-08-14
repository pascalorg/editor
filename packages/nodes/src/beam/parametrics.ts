import type { ParametricDescriptor } from '@pascal-app/core'
import type { BeamNode } from './schema'

/**
 * Inspector descriptor for beam.
 *
 * Length is derived from `start`/`end`, so it is not a number input the way
 * width and depth are — the endpoints are moved spatially. The formwork fields
 * (formworkType, tie/waler spacing) live on the node and flow to the assembly
 * exactly as they do for a wall, so they are exposed here too.
 */
export const beamParametrics: ParametricDescriptor<BeamNode> = {
  groups: [
    {
      label: 'Dimensions',
      fields: [
        { key: 'width', kind: 'number', unit: 'm', min: 0.15, max: 1.2, step: 0.01 },
        { key: 'depth', kind: 'number', unit: 'm', min: 0.2, max: 2, step: 0.05 },
        { key: 'elevation', kind: 'number', unit: 'm', min: 0, max: 12, step: 0.1 },
      ],
    },
    {
      label: 'Construction',
      fields: [
        {
          key: 'formworkType',
          kind: 'enum',
          options: ['plywood', 'steel-panel', 'none'],
        },
      ],
    },
  ],
}

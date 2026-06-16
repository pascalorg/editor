import type { ParametricDescriptor } from '@pascal-app/core'
import type { PipeFittingNode } from './schema'

export const pipeFittingParametrics: ParametricDescriptor<PipeFittingNode> = {
  groups: [
    {
      label: 'Fitting',
      fields: [
        {
          key: 'fittingType',
          kind: 'enum',
          options: ['elbow', 'wye', 'sanitary-tee', 'cross'],
          display: 'segmented',
        },
        {
          key: 'angle',
          kind: 'number',
          unit: '°',
          min: 15,
          max: 90,
          step: 7.5,
          visibleIf: (n) => n.fittingType === 'elbow',
        },
        {
          key: 'system',
          kind: 'enum',
          options: ['waste', 'vent'],
          display: 'segmented',
        },
      ],
    },
    {
      label: 'Connections',
      fields: [
        { key: 'diameter', kind: 'number', unit: 'in', min: 1.25, max: 6, step: 0.25 },
        {
          key: 'diameter2',
          kind: 'number',
          unit: 'in',
          min: 1.25,
          max: 6,
          step: 0.25,
          visibleIf: (n) => n.fittingType !== 'elbow',
        },
        { key: 'pipeMaterial', kind: 'enum', options: ['pvc', 'abs', 'cast-iron'] },
      ],
    },
    {
      label: 'Placement',
      fields: [
        { key: 'position', kind: 'vec3' },
        { key: 'rotation', kind: 'vec3' },
      ],
    },
  ],
}

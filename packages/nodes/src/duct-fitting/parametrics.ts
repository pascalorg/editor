import type { ParametricDescriptor } from '@pascal-app/core'
import type { DuctFittingNode } from './schema'

export const ductFittingParametrics: ParametricDescriptor<DuctFittingNode> = {
  groups: [
    {
      label: 'Fitting',
      fields: [
        {
          key: 'fittingType',
          kind: 'enum',
          options: ['elbow', 'tee', 'reducer'],
          display: 'segmented',
        },
        {
          key: 'angle',
          kind: 'number',
          unit: '°',
          min: 15,
          max: 90,
          step: 15,
          visibleIf: (n) => n.fittingType === 'elbow',
        },
        {
          key: 'system',
          kind: 'enum',
          options: ['supply', 'return'],
          display: 'segmented',
        },
      ],
    },
    {
      label: 'Connections',
      fields: [
        {
          key: 'shape',
          kind: 'enum',
          options: ['round', 'rect'],
          display: 'segmented',
          visibleIf: (n) => n.fittingType !== 'reducer',
        },
        {
          key: 'diameter',
          kind: 'number',
          unit: 'in',
          min: 4,
          max: 24,
          step: 1,
          visibleIf: (n) => n.shape !== 'rect' || n.fittingType === 'reducer',
        },
        {
          key: 'width',
          kind: 'number',
          unit: 'in',
          min: 4,
          max: 60,
          step: 1,
          visibleIf: (n) => n.shape === 'rect' && n.fittingType !== 'reducer',
        },
        {
          key: 'height',
          kind: 'number',
          unit: 'in',
          min: 3,
          max: 40,
          step: 1,
          visibleIf: (n) => n.shape === 'rect' && n.fittingType !== 'reducer',
        },
        {
          key: 'diameter2',
          kind: 'number',
          unit: 'in',
          min: 4,
          max: 24,
          step: 1,
          visibleIf: (n) => n.fittingType !== 'elbow',
        },
        {
          key: 'ductMaterial',
          kind: 'enum',
          options: ['sheet-metal', 'flex', 'duct-board'],
        },
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

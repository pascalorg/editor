import type { ParametricDescriptor } from '@pascal-app/core'
import type { SkylightNode } from './schema'

export const skylightParametrics: ParametricDescriptor<SkylightNode> = {
  customPanel: () => import('./panel'),
  groups: [
    {
      label: 'Type',
      fields: [
        {
          key: 'skylightType',
          kind: 'enum',
          options: ['flat', 'walk-on', 'lantern', 'opening', 'sliding'],
          display: 'select',
        },
      ],
    },
    {
      label: 'Dimensions',
      fields: [
        { key: 'width', kind: 'number', unit: 'm', min: 0.3, max: 3, step: 0.05 },
        { key: 'height', kind: 'number', unit: 'm', min: 0.3, max: 3, step: 0.05 },
        { key: 'frameThickness', kind: 'number', unit: 'm', min: 0.02, max: 0.15, step: 0.005 },
        { key: 'frameDepth', kind: 'number', unit: 'm', min: 0.02, max: 0.2, step: 0.005 },
        { key: 'glassThickness', kind: 'number', unit: 'm', min: 0.005, max: 0.05, step: 0.001 },
      ],
    },
    {
      label: 'Curb',
      fields: [
        { key: 'curb', kind: 'boolean' },
        {
          key: 'curbHeight',
          kind: 'number',
          unit: 'm',
          min: 0,
          max: 0.3,
          step: 0.01,
          visibleIf: (n) => n.curb === true,
        },
      ],
    },
    {
      label: 'Opening',
      fields: [
        {
          key: 'operationState',
          kind: 'number',
          min: 0,
          max: 1,
          step: 0.05,
          visibleIf: (n) => n.skylightType === 'opening' || n.skylightType === 'sliding',
        },
        {
          key: 'openingAngle',
          kind: 'number',
          unit: '°',
          min: 0,
          max: 60,
          step: 1,
          visibleIf: (n) => n.skylightType === 'opening',
        },
        {
          key: 'openingSide',
          kind: 'enum',
          options: ['top', 'bottom', 'left', 'right'],
          display: 'segmented',
          visibleIf: (n) => n.skylightType === 'opening',
        },
        {
          key: 'slideDirection',
          kind: 'enum',
          options: ['x', 'z'],
          display: 'segmented',
          visibleIf: (n) => n.skylightType === 'sliding',
        },
      ],
    },
    {
      label: 'Lantern',
      fields: [
        {
          key: 'lanternHeight',
          kind: 'number',
          unit: 'm',
          min: 0,
          max: 1,
          step: 0.01,
          visibleIf: (n) => n.skylightType === 'lantern',
        },
        {
          key: 'lanternTopScale',
          kind: 'number',
          min: 0,
          max: 1,
          step: 0.05,
          visibleIf: (n) => n.skylightType === 'lantern',
        },
      ],
    },
  ],
}

import type { ParametricDescriptor } from '@pascal-app/core'
import type { RidgeVentNode } from './schema'

export const ridgeVentParametrics: ParametricDescriptor<RidgeVentNode> = {
  // Custom panel exposes Position sliders + Move/Duplicate actions
  // alongside the style/dimensions controls. See box-vent's parametrics
  // for the same pattern.
  customPanel: () => import('./panel'),
  groups: [
    {
      label: 'Style',
      fields: [
        {
          key: 'style',
          kind: 'enum',
          options: ['standard', 'shingled', 'metal'],
          display: 'segmented',
        },
        { key: 'endCaps', kind: 'boolean' },
      ],
    },
    {
      label: 'Dimensions',
      fields: [
        { key: 'length', kind: 'number', unit: 'm', min: 0.5, max: 8, step: 0.05 },
        { key: 'width', kind: 'number', unit: 'm', min: 0.1, max: 0.6, step: 0.01 },
        { key: 'height', kind: 'number', unit: 'm', min: 0.03, max: 0.2, step: 0.005 },
      ],
    },
  ],
}

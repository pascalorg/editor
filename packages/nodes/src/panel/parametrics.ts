import type { ParametricDescriptor } from '@pascal-app/core'
import type { PanelNode } from './schema'

export const panelParametrics: ParametricDescriptor<PanelNode> = {
  groups: [
    {
      label: 'Size',
      fields: [
        { key: 'width', kind: 'number', unit: 'm', min: 0.05, max: 100, step: 0.05 },
        { key: 'height', kind: 'number', unit: 'm', min: 0.05, max: 100, step: 0.05 },
        { key: 'thickness', kind: 'number', unit: 'm', min: 0.005, max: 0.5, step: 0.005 },
      ],
    },
    {
      label: 'On the wall',
      fields: [
        {
          key: 'side',
          label: 'Face',
          kind: 'enum',
          options: ['front', 'back'],
          display: 'segmented',
        },
        {
          key: 'offset',
          label: 'Stand-off',
          kind: 'number',
          unit: 'm',
          min: -0.2,
          max: 1,
          step: 0.005,
        },
      ],
    },
  ],
}

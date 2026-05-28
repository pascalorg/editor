import type { ParametricDescriptor, RoundedPanelNode } from '@pascal-app/core'

export const roundedpanelParametrics: ParametricDescriptor<RoundedPanelNode> = {
  groups: [
    {
      label: 'Dimensions',
      fields: [
        { key: 'length', kind: 'number', min: 0.01, max: 20, step: 0.05, unit: 'm' },
        { key: 'width', kind: 'number', min: 0.01, max: 20, step: 0.05, unit: 'm' },
        { key: 'thickness', kind: 'number', min: 0.005, max: 2, step: 0.005, unit: 'm' },
        { key: 'cornerRadius', kind: 'number', min: 0, max: 2, step: 0.01, unit: 'm' },
        { key: 'cornerSegments', kind: 'number', min: 1, max: 12, step: 1 },
      ],
    },
  ],
}

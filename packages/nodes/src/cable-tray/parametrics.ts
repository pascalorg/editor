import type { CableTrayNode, ParametricDescriptor } from '@pascal-app/core'

export const cableTrayParametrics: ParametricDescriptor<CableTrayNode> = {
  groups: [
    {
      label: 'Dimensions',
      fields: [
        { key: 'width', kind: 'number', unit: 'm', min: 0.12, max: 1.5, step: 0.01 },
        { key: 'sideHeight', kind: 'number', unit: 'm', min: 0.04, max: 0.6, step: 0.01 },
        { key: 'thickness', kind: 'number', unit: 'm', min: 0.01, max: 0.12, step: 0.005 },
        { key: 'elevation', kind: 'number', unit: 'm', min: 0, max: 12, step: 0.05 },
        { key: 'curveOffset', kind: 'number', unit: 'm', min: -20, max: 20, step: 0.05 },
      ],
    },
    {
      label: 'Rungs',
      fields: [
        { key: 'showRungs', kind: 'boolean' },
        {
          key: 'rungSpacing',
          kind: 'number',
          unit: 'm',
          min: 0.12,
          max: 1.5,
          step: 0.01,
          visibleIf: (node) => node.showRungs,
        },
      ],
    },
    {
      label: 'Appearance',
      fields: [{ key: 'color', kind: 'color' }],
    },
  ],
}


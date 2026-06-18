import type { LadderNode, ParametricDescriptor } from '@pascal-app/core'

export const ladderParametrics: ParametricDescriptor<LadderNode> = {
  customPanel: () => import('../stair/panel'),
  groups: [
    {
      label: 'Dimensions',
      fields: [
        { key: 'height', kind: 'number', unit: 'm', min: 0.5, max: 20, step: 0.05 },
        { key: 'width', kind: 'number', unit: 'm', min: 0.25, max: 1.2, step: 0.01 },
        { key: 'standoffDepth', kind: 'number', unit: 'm', min: 0, max: 0.8, step: 0.01 },
      ],
    },
    {
      label: 'Rungs',
      fields: [
        { key: 'rungSpacing', kind: 'number', unit: 'm', min: 0.15, max: 0.6, step: 0.01 },
        { key: 'rungDiameter', kind: 'number', unit: 'm', min: 0.01, max: 0.08, step: 0.005 },
        { key: 'railDiameter', kind: 'number', unit: 'm', min: 0.015, max: 0.1, step: 0.005 },
      ],
    },
    {
      label: 'Safety cage',
      fields: [
        { key: 'cageEnabled', kind: 'boolean' },
        {
          key: 'cageRadius',
          kind: 'number',
          unit: 'm',
          min: 0.25,
          max: 0.8,
          step: 0.01,
          visibleIf: (node) => node.cageEnabled,
        },
        {
          key: 'cageStartHeight',
          kind: 'number',
          unit: 'm',
          min: 0.5,
          max: 8,
          step: 0.05,
          visibleIf: (node) => node.cageEnabled,
        },
      ],
    },
    {
      label: 'Appearance',
      fields: [{ key: 'color', kind: 'color' }],
    },
  ],
}

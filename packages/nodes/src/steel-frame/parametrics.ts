import type { ParametricDescriptor, SteelFrameNode } from '@pascal-app/core'

export const steelFrameParametrics: ParametricDescriptor<SteelFrameNode> = {
  groups: [
    {
      label: 'Frame',
      fields: [
        {
          key: 'style',
          kind: 'enum',
          options: ['pipe-rack', 'equipment-platform', 'portal-frame', 'tower-frame'],
          display: 'segmented',
        },
        {
          key: 'braceStyle',
          kind: 'enum',
          options: ['single-diagonal', 'knee', 'none'],
          display: 'segmented',
        },
        { key: 'levels', kind: 'number', min: 1, max: 8, step: 1 },
        { key: 'columns', kind: 'number', min: 2, max: 12, step: 1 },
        { key: 'rows', kind: 'number', min: 2, max: 6, step: 1 },
      ],
    },
    {
      label: 'Dimensions',
      fields: [
        { key: 'length', kind: 'number', unit: 'm', min: 1, max: 40, step: 0.1 },
        { key: 'width', kind: 'number', unit: 'm', min: 0.6, max: 20, step: 0.1 },
        { key: 'height', kind: 'number', unit: 'm', min: 1, max: 40, step: 0.1 },
        { key: 'memberSize', kind: 'number', unit: 'm', min: 0.04, max: 0.8, step: 0.01 },
        { key: 'braceSize', kind: 'number', unit: 'm', min: 0.02, max: 0.4, step: 0.01 },
        { key: 'deckThickness', kind: 'number', unit: 'm', min: 0.02, max: 0.4, step: 0.01 },
      ],
    },
    {
      label: 'Appearance',
      fields: [
        { key: 'color', kind: 'color' },
        { key: 'deckColor', kind: 'color' },
      ],
    },
  ],
}

import { type ParametricDescriptor, type PlantingNode, useScene } from '@pascal-app/core'
import { PlantingAreaControl } from './area-control'

export const plantingParametrics: ParametricDescriptor<PlantingNode> = {
  groups: [
    {
      label: 'Layout',
      fields: [
        {
          key: 'area',
          kind: 'custom',
          component: PlantingAreaControl,
          visibleIf: (node) => node.area !== undefined,
        },
        {
          key: 'pattern',
          kind: 'enum',
          options: ['drifts', 'mixed', 'rows'],
          display: 'segmented',
        },
        { key: 'seed', kind: 'number', min: -2147483648, max: 2147483647, step: 1 },
      ],
    },
    {
      label: 'Ground',
      fields: [
        { key: 'ground', kind: 'enum', options: ['soil', 'mulch', 'none'], display: 'segmented' },
        { key: 'edging', kind: 'enum', options: ['none', 'steel', 'stone'], display: 'segmented' },
      ],
    },
  ],
  trailingSection: () => import('./plants-panel'),
  actions: [
    {
      label: 'Randomise',
      onClick: (node) => {
        const next = Math.floor(Math.random() * 10_000)
        useScene
          .getState()
          .updateNode(node.id, { seed: next === node.seed ? (next + 1) % 10_000 : next })
      },
    },
  ],
}

import { HEDGE_LIMITS, type HedgeNode, type ParametricDescriptor, useScene } from '@pascal-app/core'

export const hedgeParametrics: ParametricDescriptor<HedgeNode> = {
  groups: [
    {
      label: 'Shape',
      fields: [
        {
          key: 'height',
          kind: 'number',
          unit: 'm',
          min: HEDGE_LIMITS.minHeight,
          max: HEDGE_LIMITS.maxHeight,
          step: 0.05,
        },
        {
          key: 'width',
          kind: 'number',
          unit: 'm',
          min: HEDGE_LIMITS.minWidth,
          max: HEDGE_LIMITS.maxWidth,
          step: 0.05,
        },
        { key: 'clip', kind: 'number', min: 0, max: 1, step: 0.05 },
        { key: 'curve', label: 'Curved line', kind: 'boolean' },
        {
          key: 'closed',
          label: 'Closed ring',
          kind: 'boolean',
          visibleIf: (n) => n.path.length > 2,
        },
        { key: 'seed', kind: 'number', min: 0, max: 9999, step: 1 },
      ],
    },
    {
      label: 'Foliage',
      fields: [
        {
          key: 'leafSize',
          label: 'Leaf size',
          kind: 'number',
          unit: 'm',
          min: HEDGE_LIMITS.minLeafSize,
          max: HEDGE_LIMITS.maxLeafSize,
          step: 0.01,
        },
        { key: 'leafColor', label: 'Leaf color', kind: 'color' },
      ],
    },
  ],
  actions: [
    {
      label: 'Randomise',
      // Another seed, another hedge of the same numbers: one write, one undo step.
      onClick: (hedge) => {
        const next = Math.floor(Math.random() * 10_000)
        useScene
          .getState()
          .updateNode(hedge.id, { seed: next === hedge.seed ? (next + 1) % 10_000 : next })
      },
    },
  ],
}

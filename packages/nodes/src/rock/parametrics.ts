import { type ParametricDescriptor, ROCK_LIMITS, type RockNode, useScene } from '@pascal-app/core'

export const rockParametrics: ParametricDescriptor<RockNode> = {
  groups: [
    {
      label: 'Shape',
      fields: [
        {
          key: 'rockType',
          label: 'Rock type',
          kind: 'enum',
          options: ['boulder', 'fjord', 'granite', 'volcanic', 'river', 'stacked', 'stepping'],
        },
        {
          key: 'height',
          kind: 'number',
          unit: 'm',
          min: ROCK_LIMITS.minHeight,
          max: ROCK_LIMITS.maxHeight,
          step: 0.01,
        },
        { key: 'seed', kind: 'number', min: 0, max: 9999, step: 1 },
        {
          key: 'form',
          kind: 'enum',
          options: ['faceted', 'weathered'],
          display: 'segmented',
        },
      ],
    },
    {
      label: 'Stone',
      fields: [
        {
          key: 'weathering',
          kind: 'number',
          min: 0,
          max: 1,
          step: 0.05,
        },
        {
          key: 'moss',
          kind: 'number',
          min: 0,
          max: 1,
          step: 0.05,
        },
        { key: 'strata', kind: 'boolean' },
        { key: 'lichen', kind: 'number', min: 0, max: 1, step: 0.05 },
      ],
    },
  ],
  actions: [
    {
      label: 'Randomise',
      onClick: (rock) => {
        const draw = Math.floor(Math.random() * 10_000)
        const seed = draw === rock.seed ? (draw + 1) % 10_000 : draw
        useScene.getState().updateNode(rock.id, { seed })
      },
    },
  ],
}

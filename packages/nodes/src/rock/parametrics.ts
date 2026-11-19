import { type ParametricDescriptor, type RockNode, useScene } from '@pascal-app/core'
import { RockGenerationField, rockUpgradeProblem } from './generation-field'

export const rockParametrics: ParametricDescriptor<RockNode> = {
  groups: [
    {
      label: 'Shape',
      fields: [
        { key: 'gen', kind: 'custom', component: RockGenerationField },
        {
          key: 'rockType',
          label: 'Rock type',
          kind: 'enum',
          options: ['boulder', 'fjord', 'granite', 'volcanic', 'river', 'stacked', 'stepping'],
          visibleIf: (rock) => rock.gen === 2,
        },
        {
          key: 'height',
          kind: 'number',
          unit: 'm',
          // Match the positive schema without imposing a modeled minimum stone thickness.
          min: Number.MIN_VALUE,
          max: 60,
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
          visibleIf: (rock) => rock.gen === 2,
        },
        {
          key: 'moss',
          kind: 'number',
          min: 0,
          max: 1,
          step: 0.05,
          visibleIf: (rock) => rock.gen === 2,
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
    {
      label: 'Upgrade to gen 2',
      // Offered on a legacy rock only: a rock already on the current generator has nothing to upgrade.
      visibleIf: (rock) => (rock.gen ?? 1) === 1,
      enabledIf: (rock) => (rock.gen ?? 1) === 1 && rockUpgradeProblem(rock) === null,
      onClick: (rock) => {
        if ((rock.gen ?? 1) !== 1 || rockUpgradeProblem(rock)) return
        useScene.getState().updateNode(rock.id, { gen: 2 })
      },
    },
  ],
}

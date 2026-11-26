import { LAWN_LIMITS, type LawnNode, type ParametricDescriptor } from '@pascal-app/core'

export const lawnParametrics: ParametricDescriptor<LawnNode> = {
  groups: [
    {
      label: 'Grass',
      fields: [
        {
          key: 'height',
          label: 'Height',
          kind: 'number',
          unit: 'm',
          min: LAWN_LIMITS.minHeight,
          max: LAWN_LIMITS.maxHeight,
          step: 0.01,
        },
        {
          key: 'bladeWidth',
          label: 'Blade width',
          kind: 'number',
          unit: 'm',
          min: LAWN_LIMITS.minBladeWidth,
          max: LAWN_LIMITS.maxBladeWidth,
          step: 0.001,
        },
        {
          key: 'density',
          label: 'Blades per square meter',
          kind: 'number',
          min: LAWN_LIMITS.minDensity,
          max: LAWN_LIMITS.maxDensity,
          step: 1,
        },
        {
          key: 'roughness',
          label: 'Roughness',
          kind: 'number',
          min: 0,
          max: 1,
          step: 0.05,
        },
        {
          key: 'color',
          label: 'Grass color',
          kind: 'color',
        },
        {
          key: 'edgeFade',
          label: 'Soft edge',
          kind: 'number',
          unit: 'm',
          min: 0,
          max: LAWN_LIMITS.maxEdgeFade,
          step: 0.01,
        },
        {
          key: 'wind',
          label: 'Wind',
          kind: 'number',
          min: 0,
          max: 1,
          step: 0.05,
        },
        {
          key: 'seed',
          label: 'Seed',
          kind: 'number',
          min: -2147483648,
          max: 2147483647,
          step: 1,
        },
      ],
    },
    {
      label: 'Flowers',
      fields: [
        {
          key: 'flowerDensity',
          label: 'Flower heads per square meter',
          kind: 'number',
          min: 0,
          max: LAWN_LIMITS.maxFlowerDensity,
          step: 0.1,
        },
      ],
    },
  ],
  trailingSection: () => import('./parametrics-flowers'),
}

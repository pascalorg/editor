import {
  defaultI18n as i18n,
  LAWN_LIMITS,
  type LawnNode,
  type ParametricDescriptor,
} from '@pascal-app/core'

export const lawnParametrics: ParametricDescriptor<LawnNode> = {
  groups: [
    {
      label: i18n._({ id: 'node.lawn.parameters.grass', message: 'Grass' }),
      fields: [
        {
          key: 'height',
          label: i18n._({ id: 'node.lawn.parameters.height', message: 'Height' }),
          kind: 'number',
          unit: 'm',
          min: LAWN_LIMITS.minHeight,
          max: LAWN_LIMITS.maxHeight,
          step: 0.01,
        },
        {
          key: 'bladeWidth',
          label: i18n._({ id: 'node.lawn.parameters.bladeWidth', message: 'Blade width' }),
          kind: 'number',
          unit: 'm',
          min: LAWN_LIMITS.minBladeWidth,
          max: LAWN_LIMITS.maxBladeWidth,
          step: 0.001,
        },
        {
          key: 'density',
          label: i18n._({ id: 'node.lawn.parameters.density', message: 'Blades per square metre' }),
          kind: 'number',
          min: LAWN_LIMITS.minDensity,
          max: LAWN_LIMITS.maxDensity,
          step: 1,
        },
        {
          key: 'roughness',
          label: i18n._({ id: 'node.lawn.parameters.roughness', message: 'Roughness' }),
          kind: 'number',
          min: 0,
          max: 1,
          step: 0.05,
        },
        {
          key: 'color',
          label: i18n._({ id: 'node.lawn.parameters.color', message: 'Grass colour' }),
          kind: 'color',
        },
        {
          key: 'edgeFade',
          label: i18n._({ id: 'node.lawn.parameters.edgeFade', message: 'Soft edge' }),
          kind: 'number',
          unit: 'm',
          min: 0,
          max: LAWN_LIMITS.maxEdgeFade,
          step: 0.01,
        },
        {
          key: 'wind',
          label: i18n._({ id: 'node.lawn.parameters.wind', message: 'Wind' }),
          kind: 'number',
          min: 0,
          max: 1,
          step: 0.05,
        },
        {
          key: 'seed',
          label: i18n._({ id: 'node.lawn.parameters.seed', message: 'Seed' }),
          kind: 'number',
          min: -2147483648,
          max: 2147483647,
          step: 1,
        },
      ],
    },
    {
      label: i18n._({ id: 'node.lawn.parameters.flowers', message: 'Flowers' }),
      fields: [
        {
          key: 'flowerDensity',
          label: i18n._({
            id: 'node.lawn.parameters.flowerDensity',
            message: 'Flower heads per square metre',
          }),
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

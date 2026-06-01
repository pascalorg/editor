import type { ParametricDescriptor, TrapezoidPrismNode } from '@pascal-app/core'

export const trapezoidPrismParametrics: ParametricDescriptor<TrapezoidPrismNode> = {
  groups: [
    {
      label: 'Dimensions',
      fields: [
        { key: 'length', kind: 'number', min: 0.01, max: 50, step: 0.05, unit: 'm' },
        { key: 'width', kind: 'number', min: 0.01, max: 50, step: 0.05, unit: 'm' },
        { key: 'height', kind: 'number', min: 0.01, max: 20, step: 0.05, unit: 'm' },
        { key: 'topLengthScale', kind: 'number', min: 0.01, max: 3, step: 0.05 },
        { key: 'topWidthScale', kind: 'number', min: 0.01, max: 3, step: 0.05 },
      ],
    },
  ],
}

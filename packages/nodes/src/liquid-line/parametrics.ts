import type { ParametricDescriptor } from '@pascal-app/core'
import type { LiquidLineNode } from './schema'

export const liquidLineParametrics: ParametricDescriptor<LiquidLineNode> = {
  groups: [
    {
      label: 'Line',
      labelKey: 'nodes.liquidLine.line',
      fields: [
        {
          key: 'diameter',
          kind: 'number',
          unit: 'in',
          min: 0.125,
          max: 0.75,
          step: 0.125,
        },
      ],
    },
  ],
}

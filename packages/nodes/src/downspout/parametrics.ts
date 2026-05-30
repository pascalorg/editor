import type { ParametricDescriptor } from '@pascal-app/core'
import type { DownspoutNode } from './schema'

export const downspoutParametrics: ParametricDescriptor<DownspoutNode> = {
  groups: [
    {
      label: 'Dimensions',
      fields: [
        { key: 'length', kind: 'number', unit: 'm', min: 0.1, max: 8, step: 0.05 },
        { key: 'diameter', kind: 'number', unit: 'm', min: 0.02, max: 0.15, step: 0.005 },
      ],
    },
  ],
}

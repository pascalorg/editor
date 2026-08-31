import type { ParametricDescriptor } from '@pascal-app/core'
import type { BlockNode } from './schema'

export const blockParametrics: ParametricDescriptor<BlockNode> = {
  groups: [
    {
      label: 'Position',
      fields: [{ key: 'position', kind: 'vec3' }],
    },
  ],
  customPanel: () => import('./panel'),
}

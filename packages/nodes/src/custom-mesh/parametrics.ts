import type { ParametricDescriptor } from '@pascal-app/core'
import type { CustomMeshNode } from './schema'

export const customMeshParametrics: ParametricDescriptor<CustomMeshNode> = {
  groups: [
    {
      label: 'Position',
      fields: [{ key: 'position', kind: 'vec3' }],
    },
  ],
}

import type { AssemblyNode, ParametricDescriptor } from '@pascal-app/core'

export const assemblyParametrics: ParametricDescriptor<AssemblyNode> = {
  groups: [],
  customPanel: () => import('./panel'),
}

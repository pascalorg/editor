import type { ParametricDescriptor, SphereNode } from '@pascal-app/core'

export const sphereParametrics: ParametricDescriptor<SphereNode> = {
  groups: [],
  customPanel: () => import('./panel'),
}

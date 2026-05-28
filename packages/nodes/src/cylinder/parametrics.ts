import type { CylinderNode, ParametricDescriptor } from '@pascal-app/core'

export const cylinderParametrics: ParametricDescriptor<CylinderNode> = {
  groups: [],
  customPanel: () => import('./panel'),
}

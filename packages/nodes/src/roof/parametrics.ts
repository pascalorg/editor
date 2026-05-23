import type { ParametricDescriptor, RoofNode } from '@pascal-app/core'

export const roofParametrics: ParametricDescriptor<RoofNode> = {
  groups: [],
  customPanel: () => import('./panel'),
}

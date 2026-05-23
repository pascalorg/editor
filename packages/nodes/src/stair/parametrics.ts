import type { ParametricDescriptor, StairNode } from '@pascal-app/core'

export const stairParametrics: ParametricDescriptor<StairNode> = {
  groups: [],
  customPanel: () => import('./panel'),
}

import type { BoxNode, ParametricDescriptor } from '@pascal-app/core'

export const boxParametrics: ParametricDescriptor<BoxNode> = {
  groups: [],
  customPanel: () => import('./panel'),
}

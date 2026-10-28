import type { FootingNode, ParametricDescriptor } from '@pascal-app/core'

export const footingParametrics: ParametricDescriptor<FootingNode> = {
  groups: [],
  customPanel: () => import('./panel'),
}

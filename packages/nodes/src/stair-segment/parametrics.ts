import type { ParametricDescriptor, StairSegmentNode } from '@pascal-app/core'

export const stairSegmentParametrics: ParametricDescriptor<StairSegmentNode> = {
  groups: [],
  customPanel: () => import('./panel'),
}

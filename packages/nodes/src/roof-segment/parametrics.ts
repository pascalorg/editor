import type { ParametricDescriptor, RoofSegmentNode } from '@pascal-app/core'

export const roofSegmentParametrics: ParametricDescriptor<RoofSegmentNode> = {
  groups: [],
  customPanel: () => import('./panel'),
}

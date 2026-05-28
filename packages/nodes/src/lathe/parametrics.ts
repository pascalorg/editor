import type { ParametricDescriptor, LatheNode } from '@pascal-app/core'

export const latheParametrics: ParametricDescriptor<LatheNode> = {
  groups: [],
  customPanel: () => import('./panel'),
}

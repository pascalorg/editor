import type { ParametricDescriptor, UnitNode } from '@pascal-app/core'

export const unitParametrics: ParametricDescriptor<UnitNode> = {
  groups: [],
  customPanel: () => import('./unit-panel'),
}

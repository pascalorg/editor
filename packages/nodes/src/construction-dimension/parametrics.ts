import type { ConstructionDimensionNode, ParametricDescriptor } from '@pascal-app/core'

export const constructionDimensionParametrics: ParametricDescriptor<ConstructionDimensionNode> = {
  groups: [],
  customPanel: () => import('./panel'),
}

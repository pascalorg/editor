import type { ConstructionNoteNode, ParametricDescriptor } from '@pascal-app/core'

export const constructionNoteParametrics: ParametricDescriptor<ConstructionNoteNode> = {
  groups: [],
  customPanel: () => import('./panel'),
}

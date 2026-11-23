import type { PascalI18n } from '@pascal-app/core'

export function treePlacementMessage(code: string, i18n: PascalI18n): string {
  if (code === 'tree_inside_building')
    return i18n._({
      id: 'node.tree.placement.insideBuilding',
      message: 'Plant the trunk outside the building footprint.',
    })
  if (code === 'no_site' || code === 'ambiguous_site')
    return i18n._({
      id: 'node.tree.placement.noSite',
      message: 'Choose a Site before planting a tree.',
    })
  if (code === 'tree_transform_unsupported')
    return i18n._({
      id: 'node.tree.placement.transform',
      message: 'This building transform cannot be used for tree placement.',
    })
  return i18n._({
    id: 'node.tree.placement.invalid',
    message: 'The tree cannot be planted here. Choose another ground position.',
  })
}

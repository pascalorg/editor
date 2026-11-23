import type { AnyNode } from '@pascal-app/core'

/**
 * A node's human label, the same in the baked artifact (`extras.label`) and the
 * viewer's breadcrumb: an explicit name wins, items fall back to their catalog
 * asset name, other kinds to a type word.
 */
export function nodeDisplayLabel(node: AnyNode): string {
  if (node.name) return node.name
  switch (node.type) {
    case 'item':
      return (node as { asset?: { name?: string } }).asset?.name || 'Item'
    case 'wall':
      return 'Wall'
    case 'door':
      return 'Door'
    case 'window':
      return 'Window'
    case 'cabinet':
    case 'cabinet-module':
      return 'Cabinet'
    case 'slab':
      return 'Slab'
    case 'ceiling':
      return 'Ceiling'
    case 'roof':
      return 'Roof'
    case 'fence':
      return 'Fence'
    case 'column':
      return 'Column'
    case 'stair':
      return 'Stairs'
    default:
      return node.type
  }
}

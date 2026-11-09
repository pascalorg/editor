import type { AnyNode } from '@pascal-app/core'

// What the nodes package declares as `capabilities.exterior` for its wall, door and window, written
// out for the tests that register their own throw-away kinds (`packages/editor` does not import
// `@pascal-app/nodes`).

/** A wall with an outdoor face. */
export const wallExterior = (node: AnyNode) =>
  node.type === 'wall' && (node.frontSide === 'exterior' || node.backSide === 'exterior')

/** An opening in a roof segment or in such a wall. */
export const openingExterior = (node: AnyNode, nodes: Readonly<Record<string, AnyNode>>) => {
  if (node.type !== 'door' && node.type !== 'window') return false
  if (node.roofSegmentId) return true
  const host = nodes[node.wallId ?? node.parentId ?? '']
  return host ? wallExterior(host) : false
}

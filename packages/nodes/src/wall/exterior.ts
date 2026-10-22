import type { AnyNode } from '@pascal-app/core'

/** A wall with an outdoor face: the cutaway treats it as a wall seen from outside or inside. */
export function wallSeenFromOutside(node: AnyNode): boolean {
  return node.type === 'wall' && (node.frontSide === 'exterior' || node.backSide === 'exterior')
}

/** An opening in a roof segment, or in a wall with an outdoor face, is seen from outside. */
export function openingSeenFromOutside(
  node: AnyNode,
  nodes: Readonly<Record<string, AnyNode>>,
): boolean {
  if (node.type !== 'door' && node.type !== 'window') return false
  if (node.roofSegmentId) return true
  const host = nodes[node.wallId ?? node.parentId ?? '']
  return host ? wallSeenFromOutside(host) : false
}

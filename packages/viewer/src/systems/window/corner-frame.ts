import { type AnyNode, cornerPair, fusesAtCorner, sceneRegistry } from '@pascal-app/core'

/** Where a window mesh keeps the corner side its frame was built fused on (-1, 0 or 1). */
export const FUSED_CORNER_SIDE = 'fusedCornerSide'

/**
 * Whether a window's frame was built for a corner pair that has since been made or broken without
 * the window changing (its partner deleted or moved, a wall moved apart): a build reads the pair
 * once, so the window rebuilds.
 */
export function cornerFrameStale(node: AnyNode, nodes: Readonly<Record<string, AnyNode>>): boolean {
  if (node.type !== 'window') return false
  const mesh = sceneRegistry.nodes.get(node.id)
  if (!mesh) return false
  const fused = cornerPair(nodes, node)?.post === 'none' && fusesAtCorner(node)
  return Boolean(mesh.userData[FUSED_CORNER_SIDE]) !== fused
}

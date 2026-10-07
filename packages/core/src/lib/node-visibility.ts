import type { AnyNode } from '../schema'

/**
 * Whether a node's `visible: false` also hides the nodes beneath it.
 *
 * A Site is the parcel reference, not a container: hiding it hides its own
 * ground fill and boundary only, and the buildings on it keep their own flag.
 * Every other kind hides its whole subtree. Exports, the 2D plan and the
 * validators all read this one rule so a hidden Site can never empty a scene.
 */
export function hidesDescendants(node: Pick<AnyNode, 'type'>): boolean {
  return node.type !== 'site'
}

export const HIDDEN_SITE_NOTE =
  'A hidden Site hides only its own ground fill and boundary; the buildings on it stay visible in the viewport, the 2D plan and every export.'

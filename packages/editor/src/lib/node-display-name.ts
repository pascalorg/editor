import { type AnyNode, nodeRegistry } from '@pascal-app/core'

/**
 * What a node is called wherever the user reads its name.
 *
 * The order is the whole content of this function, and each step exists
 * because the one after it is wrong on its own:
 *
 * 1. **`def.tree.label`** — the kind's own derive, and the only step that can
 *    tell two products of one kind apart. It reads the node, so a rack that is
 *    switched from pallet to low answers differently the moment the field
 *    changes.
 * 2. **`node.name`** — the user's rename, which the derive is expected to
 *    return itself when it is set (see the plugin-side `treeLabel` helper).
 *    Kept here for kinds that declare no derive at all.
 * 3. **`def.presentation.label`** — one fixed string per KIND. Correct only
 *    where a kind is a single product; it is what made a low rack read
 *    "Pallet Rack".
 * 4. The raw type, so a row is never blank.
 *
 * Shared rather than written twice: the scene tree and the inspector header
 * name the same object, and having them disagree is its own bug — the tree
 * said "Low Rack" while the panel editing that very node said "Pallet Rack".
 */
export function resolveNodeDisplayName(
  node: AnyNode | undefined,
  nodes: Readonly<Record<string, AnyNode>>,
): string {
  if (!node) return ''
  const def = nodeRegistry.get(node.type)
  return def?.tree?.label?.(node, nodes) || node.name || def?.presentation?.label || node.type || ''
}

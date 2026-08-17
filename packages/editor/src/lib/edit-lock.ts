import { type AnyNode, type AnyNodeId, categoryOf, useScene } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'

/**
 * Whether a node is currently edit-locked — `sceneLocked` (everything) or its
 * category being in `lockedCategories`. Locked nodes stay selectable and
 * inspectable; the editor blocks move / delete / transform on them. The lock
 * state lives in the viewer's presentation store (`useViewer`), so both the
 * viewer's selection manager and the editor's edit paths can read it without
 * either package importing the other's edit vocabulary.
 */
export function isNodeEditLocked(node: AnyNode): boolean {
  const { sceneLocked, lockedCategories } = useViewer.getState()
  if (sceneLocked) return true
  if (lockedCategories.size === 0) return false
  const category = categoryOf(node.type)
  return category !== null && lockedCategories.has(category)
}

/** {@link isNodeEditLocked} by id, resolving the node from the scene. */
export function isNodeIdEditLocked(id: AnyNodeId): boolean {
  const node = useScene.getState().nodes[id]
  return node ? isNodeEditLocked(node) : false
}

/** The subset of `ids` that are not edit-locked (safe to move / delete). */
export function filterEditableIds(ids: readonly AnyNodeId[]): AnyNodeId[] {
  return ids.filter((id) => !isNodeIdEditLocked(id))
}

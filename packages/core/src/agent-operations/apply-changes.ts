import type { AnyNode } from '../schema'
import type { SceneChanges, SceneNodes } from './types'

/** The scene after an operation's changes, without a store: for checks and previews. */
export function applySceneChanges(
  nodes: SceneNodes,
  changes: SceneChanges | undefined,
): Record<string, AnyNode> {
  const next: Record<string, AnyNode> = { ...nodes }
  const remove = (id: string) => {
    const node = next[id]
    delete next[id]
    if (node && 'children' in node && Array.isArray(node.children))
      for (const child of node.children as string[]) remove(child)
  }
  for (const id of changes?.delete ?? []) remove(id)
  for (const { id, data } of changes?.update ?? [])
    if (next[id]) next[id] = { ...next[id], ...data } as AnyNode
  for (const { node } of changes?.create ?? []) next[node.id] = node
  return next
}

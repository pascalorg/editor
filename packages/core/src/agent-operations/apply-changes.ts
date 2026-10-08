import type { AnyNode, Collection } from '../schema'
import type { SceneChanges, SceneNodes } from './types'

const childrenOf = (node: AnyNode | undefined): string[] | null =>
  node && 'children' in node && Array.isArray(node.children) ? (node.children as string[]) : null

/**
 * The scene after an operation's changes, without a store: for checks and previews. Same order as
 * the store's applyNodeChanges — updates, creates, then deletes — so an opening moved off a wall
 * being replaced is no longer among that wall's children when it goes.
 */
export function applySceneChanges(
  nodes: SceneNodes,
  changes: SceneChanges | undefined,
): Record<string, AnyNode> {
  const next: Record<string, AnyNode> = { ...nodes }
  const setChildren = (parentId: string | null | undefined, edit: (ids: string[]) => string[]) => {
    const parent = parentId ? next[parentId] : undefined
    const children = childrenOf(parent)
    if (parent && children) next[parent.id] = { ...parent, children: edit(children) } as AnyNode
  }
  const detach = (parentId: string | null | undefined, id: string) =>
    setChildren(parentId, (ids) => ids.filter((child) => child !== id))
  const attach = (parentId: string | null | undefined, id: string) =>
    setChildren(parentId, (ids) => (ids.includes(id) ? ids : [...ids, id]))
  for (const { id, data } of changes?.update ?? []) {
    const current = next[id]
    if (!current) continue
    if (data.parentId !== undefined && data.parentId !== current.parentId) {
      detach(current.parentId, id)
      attach(data.parentId, id)
    }
    next[id] = { ...current, ...data } as AnyNode
  }
  for (const { node, parentId } of changes?.create ?? []) {
    next[node.id] = parentId ? ({ ...node, parentId } as AnyNode) : node
    attach(parentId ?? node.parentId, node.id)
  }
  const remove = (id: string) => {
    const node = next[id]
    delete next[id]
    for (const child of childrenOf(node) ?? []) remove(child)
  }
  for (const id of changes?.delete ?? []) {
    detach(next[id]?.parentId, id)
    remove(id)
  }
  return next
}

/**
 * Several operations' changes, in order, as one set that lands the scene where applying them one
 * by one does — whether a surface applies creates, updates or deletes first: a batch is one undo
 * step. Updates to a node the batch created are folded into its creation, and a node created then
 * deleted never appears; updates only reach nodes that existed before, deletes come last.
 */
export function mergeSceneChanges(sets: readonly SceneChanges[]): Required<SceneChanges> {
  const created = new Map<string, { node: AnyNode; parentId?: string }>()
  const updated = new Map<string, Partial<AnyNode>>()
  const deleted = new Set<string>()
  const collections: Record<string, Collection | null> = {}
  const dropCreated = (id: string) => {
    created.delete(id)
    for (const [childId, entry] of [...created])
      if ((entry.parentId ?? entry.node.parentId) === id) dropCreated(childId)
  }
  for (const set of sets) {
    Object.assign(collections, set.collections)
    for (const { id, data } of set.update ?? []) {
      const entry = created.get(id)
      if (entry)
        created.set(id, {
          node: { ...entry.node, ...data } as AnyNode,
          parentId: (data.parentId as string | undefined) ?? entry.parentId,
        })
      else updated.set(id, { ...updated.get(id), ...data } as Partial<AnyNode>)
    }
    for (const entry of set.create ?? []) created.set(entry.node.id, entry)
    for (const id of set.delete ?? []) {
      if (created.has(id)) {
        dropCreated(id)
        continue
      }
      updated.delete(id)
      deleted.add(id)
    }
  }
  return {
    create: [...created.values()],
    update: [...updated].map(([id, data]) => ({ id, data })),
    delete: [...deleted],
    collections,
  }
}

import { draftOf } from '../runtime/reader'
import type { AnyNode, Collection, SceneMaterial } from '../schema'
import type { NodeWrite, SceneChanges, SceneNodes } from './types'

const childrenOf = (node: AnyNode | undefined): string[] | null =>
  node && 'children' in node && Array.isArray(node.children) ? (node.children as string[]) : null

/**
 * A node with a patch applied. A field the patch sets to `undefined` is removed, as the store's
 * updateNode removes it: optional fields encode a mode by their absence.
 */
function patched(node: AnyNode, data: Partial<AnyNode>): AnyNode {
  const merged: Record<string, unknown> = { ...node, ...data }
  for (const [key, value] of Object.entries(data)) if (value === undefined) delete merged[key]
  return merged as AnyNode
}

/**
 * The scene after a write's operations in their order, without a store: each create attached to its
 * parent, each reparent moved between both parents' `children`, each delete taking everything under
 * it. A create is written as given; parse it first for its schema's defaults.
 */
export function applySceneWrites(
  nodes: SceneNodes,
  writes: readonly NodeWrite[],
): Record<string, AnyNode> {
  const next = draftOf(nodes as Record<string, AnyNode>)
  const setChildren = (parentId: string | null | undefined, edit: (ids: string[]) => string[]) => {
    const parent = parentId ? next[parentId] : undefined
    const children = childrenOf(parent)
    if (parent && children) next[parent.id] = { ...parent, children: edit(children) } as AnyNode
  }
  const detach = (parentId: string | null | undefined, id: string) =>
    setChildren(parentId, (ids) => ids.filter((child) => child !== id))
  const attach = (parentId: string | null | undefined, id: string) =>
    setChildren(parentId, (ids) => (ids.includes(id) ? ids : [...ids, id]))
  const remove = (id: string) => {
    const node = next[id]
    delete next[id]
    for (const child of childrenOf(node) ?? []) remove(child)
  }
  for (const write of writes) {
    if (write.op === 'create') {
      const { node, parentId } = write
      next[node.id] = parentId ? ({ ...node, parentId } as AnyNode) : node
      attach(parentId ?? node.parentId, node.id)
    } else if (write.op === 'update') {
      const current = next[write.id]
      if (!current) continue
      const data = write.data as Partial<AnyNode>
      if (data.parentId !== undefined && data.parentId !== current.parentId) {
        detach(current.parentId, write.id)
        attach(data.parentId, write.id)
      }
      next[write.id] = patched(current, data)
    } else if (write.op === 'delete') {
      detach(next[write.id]?.parentId, write.id)
      remove(write.id)
    }
  }
  return next
}

/**
 * The scene after an operation's changes, without a store: for checks and previews. Same order as
 * the store's applyNodeChanges — updates, creates, then deletes — so an opening moved off a wall
 * being replaced is no longer among that wall's children when it goes.
 */
export function applySceneChanges(
  nodes: SceneNodes,
  changes: SceneChanges | undefined,
): Record<string, AnyNode> {
  return applySceneWrites(nodes, [
    ...(changes?.update ?? []).map(({ id, data }) => ({ op: 'update' as const, id, data })),
    ...(changes?.create ?? []).map(({ node, parentId }) => ({
      op: 'create' as const,
      node,
      parentId,
    })),
    ...(changes?.delete ?? []).map((id) => ({ op: 'delete' as const, id })),
  ])
}

/**
 * Several operations' changes, in order, as one set that lands the scene where applying them one
 * by one does — whether a surface applies creates, updates or deletes first: a batch is one undo
 * step. Updates to a node the batch created are folded into its creation, and a node created then
 * deleted never appears; updates only reach nodes that existed before, deletes come last.
 */
export function mergeSceneChanges(
  sets: readonly SceneChanges[],
): Required<Omit<SceneChanges, 'materials'>> & Pick<SceneChanges, 'materials'> {
  const created = new Map<string, { node: AnyNode; parentId?: string }>()
  const updated = new Map<string, Partial<AnyNode>>()
  const deleted = new Set<string>()
  const collections: Record<string, Collection | null> = {}
  const materials = new Map<string, SceneMaterial>()
  const dropCreated = (id: string) => {
    created.delete(id)
    for (const [childId, entry] of [...created])
      if ((entry.parentId ?? entry.node.parentId) === id) dropCreated(childId)
  }
  for (const set of sets) {
    Object.assign(collections, set.collections)
    for (const material of set.materials ?? []) materials.set(material.id, material)
    for (const { id, data } of set.update ?? []) {
      const entry = created.get(id)
      if (entry)
        created.set(id, {
          node: patched(entry.node, data),
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
    ...(materials.size ? { materials: [...materials.values()] } : {}),
    create: [...created.values()],
    update: [...updated].map(([id, data]) => ({ id, data })),
    delete: [...deleted],
    collections,
    ...(materials.size ? { materials: [...materials.values()] } : {}),
  }
}

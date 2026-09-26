import type { AnyNode, AnyNodeId } from '../schema/types'

/**
 * Nodes an interaction is carrying (a placement or move draft). History never sees the carry:
 * a created draft is left out of every history snapshot, like a fresh-placement subtree, and
 * an adopted node's fields the carry itself wrote (`runSceneHistoryDraftWrite`) are recorded as
 * they were when the carry began. Its other fields, and writes others make meanwhile, record
 * as ordinary steps; undoing one of those steps mid-carry never resurrects or moves the draft.
 */
type SceneHistoryDraft = {
  /** The adopted node before the carry, or null for a draft the carry created. */
  original: AnyNode | null
  parentIndex: number
  attachment: unknown
  /** Fields of the adopted node the carry's own writes changed. */
  owned: Set<string>
  ended: boolean
}

const sceneHistoryDrafts = new Map<AnyNodeId, SceneHistoryDraft>()

type NodeMap = Record<AnyNodeId, AnyNode>

const childIdsOf = (node: AnyNode | undefined): AnyNodeId[] =>
  node && 'children' in node && Array.isArray(node.children) ? (node.children as AnyNodeId[]) : []
const attachmentsOf = (node: AnyNode | undefined): Record<string, unknown> | undefined =>
  node && 'attachments' in node && node.attachments && typeof node.attachments === 'object'
    ? (node.attachments as Record<string, unknown>)
    : undefined

/** Registers `id` as a carried draft; returns the call that ends it. */
export function beginSceneHistoryDraft(
  id: AnyNodeId,
  original: AnyNode | null,
  nodes: NodeMap,
): () => void {
  const parent = original?.parentId ? nodes[original.parentId as AnyNodeId] : undefined
  const draft: SceneHistoryDraft = {
    original,
    parentIndex: childIdsOf(parent).indexOf(id),
    attachment: attachmentsOf(parent)?.[id],
    owned: new Set(),
    ended: false,
  }
  sceneHistoryDrafts.set(id, draft)
  return () => {
    draft.ended = true
    if (sceneHistoryDrafts.get(id) === draft) sceneHistoryDrafts.delete(id)
  }
}

/**
 * Runs a gesture's committing write with `id` visible to history, so whichever co-owner of the
 * gesture drops it (the 3D mover or the 2D move overlay) records the change.
 */
export function withSceneHistoryDraftSuspended<T>(id: string | undefined, write: () => T): T {
  const draft = id ? sceneHistoryDrafts.get(id as AnyNodeId) : undefined
  if (!(id && draft)) return write()
  sceneHistoryDrafts.delete(id as AnyNodeId)
  try {
    return write()
  } finally {
    if (!(draft.ended || sceneHistoryDrafts.has(id as AnyNodeId))) {
      sceneHistoryDrafts.set(id as AnyNodeId, draft)
    }
  }
}

export function hasSceneHistoryDrafts(): boolean {
  return sceneHistoryDrafts.size > 0
}

/** Marks the fields a carry's own write changed on each adopted draft as carry-owned. */
export function noteSceneHistoryDraftWrite(before: NodeMap, after: NodeMap): void {
  for (const [id, draft] of sceneHistoryDrafts) {
    const previous = before[id] as Record<string, unknown> | undefined
    const next = after[id] as Record<string, unknown> | undefined
    if (!(draft.original && previous && next) || previous === next) continue
    for (const key of new Set([...Object.keys(previous), ...Object.keys(next)])) {
      if (previous[key] !== next[key]) draft.owned.add(key)
    }
  }
}

export function clearSceneHistoryDrafts(): void {
  sceneHistoryDrafts.clear()
}

/** Created drafts: history excludes them (and their subtrees) like fresh-placement nodes. */
export function createdSceneHistoryDraftIds(): AnyNodeId[] {
  return [...sceneHistoryDrafts].filter(([, draft]) => !draft.original).map(([id]) => id)
}

/** Moves `id` from wherever it lives in `nodes` to `parentId` (at `index`), with `attachment`. */
function placeChild(
  nodes: NodeMap,
  id: AnyNodeId,
  fromParentId: AnyNodeId | null | undefined,
  toParentId: AnyNodeId | null | undefined,
  index: number,
  attachment: unknown,
): void {
  const update = (parentId: AnyNodeId, edit: (node: Record<string, unknown>) => void) => {
    const parent = nodes[parentId]
    if (!parent) return
    const next = { ...parent } as Record<string, unknown>
    edit(next)
    nodes[parentId] = next as AnyNode
  }
  if (fromParentId && fromParentId !== toParentId) {
    update(fromParentId, (parent) => {
      const children = parent.children
      if (Array.isArray(children)) parent.children = children.filter((child) => child !== id)
      const attachments = parent.attachments as Record<string, unknown> | undefined
      if (attachments && Object.hasOwn(attachments, id)) {
        const { [id]: _removed, ...rest } = attachments
        parent.attachments = rest
      }
    })
  }
  if (!toParentId) return
  update(toParentId, (parent) => {
    const children = parent.children
    if (Array.isArray(children) && !children.includes(id)) {
      const next = [...children]
      next.splice(index < 0 ? next.length : Math.min(index, next.length), 0, id)
      parent.children = next
    }
    const attachments = parent.attachments as Record<string, unknown> | undefined
    if (attachment === undefined) {
      if (attachments && Object.hasOwn(attachments, id)) {
        const { [id]: _removed, ...rest } = attachments
        parent.attachments = rest
      }
    } else if (attachments?.[id] !== attachment) {
      parent.attachments = { ...(attachments ?? {}), [id]: attachment }
    }
  })
}

/**
 * Records the carry-owned fields of adopted drafts as they were before the carry. The original
 * parent link is restored only while that parent still exists. `historyNodes` may be `nodes`.
 */
export function withAdoptedDraftsAsOriginal(nodes: NodeMap, historyNodes: NodeMap): NodeMap {
  let result: NodeMap | null = null
  for (const [id, draft] of sceneHistoryDrafts) {
    const original = draft.original as Record<string, unknown> | null
    const live = nodes[id]
    if (!(original && live) || draft.owned.size === 0) continue
    const originalParentId = original.parentId as AnyNodeId | undefined
    const restoreParent =
      draft.owned.has('parentId') && (!originalParentId || Boolean(nodes[originalParentId]))
    const recorded = { ...live } as Record<string, unknown>
    for (const key of draft.owned) {
      if (key === 'parentId' && !restoreParent) continue
      if (Object.hasOwn(original, key)) recorded[key] = original[key]
      else delete recorded[key]
    }
    result ??= { ...historyNodes }
    result[id] = recorded as AnyNode
    if (restoreParent) {
      placeChild(
        result,
        id,
        live.parentId as AnyNodeId | undefined,
        originalParentId,
        draft.parentIndex,
        draft.attachment,
      )
    }
  }
  return result ?? historyNodes
}

/**
 * After an undo or redo, puts every carried draft (and a created draft's subtree) back the way
 * it was just before the jump, or null when nothing needs restoring.
 */
export function withDraftsRestored(before: NodeMap, after: NodeMap): NodeMap | null {
  let result: NodeMap | null = null
  for (const id of sceneHistoryDrafts.keys()) {
    const live = before[id]
    if (!live) continue
    const subtree = [id]
    for (let index = 0; index < subtree.length; index++) {
      for (const childId of childIdsOf(before[subtree[index]!])) subtree.push(childId)
    }
    if (subtree.every((nodeId) => after[nodeId] === before[nodeId])) continue
    result ??= { ...after }
    for (const nodeId of subtree) result[nodeId] = before[nodeId]!
    const parentId = live.parentId as AnyNodeId | undefined
    const previousParentId = after[id]?.parentId as AnyNodeId | undefined
    const beforeParent = parentId ? before[parentId] : undefined
    placeChild(
      result,
      id,
      previousParentId,
      parentId,
      childIdsOf(beforeParent).indexOf(id),
      attachmentsOf(beforeParent)?.[id],
    )
  }
  return result
}

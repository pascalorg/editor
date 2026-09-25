import type { AnyNode, AnyNodeId } from '../schema/types'

/**
 * Nodes an interaction is carrying (a placement or move draft). History never sees them: a
 * created draft is left out of every history snapshot, like a fresh-placement subtree, and an
 * adopted node is recorded as it was when the carry began. So the carry pauses no history,
 * writes others make meanwhile record as ordinary steps, and undoing one of those steps
 * mid-carry never resurrects or moves the draft.
 */
type SceneHistoryDraft = {
  /** The adopted node before the carry, or null for a draft the carry created. */
  original: AnyNode | null
  parentIndex: number
  attachment: unknown
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

/** Records adopted drafts as they were before the carry. `historyNodes` may be `nodes` itself. */
export function withAdoptedDraftsAsOriginal(nodes: NodeMap, historyNodes: NodeMap): NodeMap {
  let result: NodeMap | null = null
  for (const [id, draft] of sceneHistoryDrafts) {
    if (!draft.original) continue
    const live = nodes[id]
    if (live === draft.original) continue
    result ??= { ...historyNodes }
    result[id] = draft.original
    placeChild(
      result,
      id,
      live?.parentId as AnyNodeId | undefined,
      draft.original.parentId as AnyNodeId | undefined,
      draft.parentIndex,
      draft.attachment,
    )
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

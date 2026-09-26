import type { AnyNode, AnyNodeId } from '../schema/types'

/**
 * Nodes an interaction is carrying (a placement or move draft). History never sees the carry:
 * a created draft is left out of every history snapshot, like a fresh-placement subtree, and
 * each field of an adopted node that the carry itself wrote (`runSceneHistoryDraftWrite`) is
 * recorded as it was before that write, for as long as it still holds the carry's value.
 * Other fields, and anything others write meanwhile (including over a carry-written field,
 * which ends the carry's hold on it), record as ordinary steps; undoing one of those steps
 * mid-carry puts back only the carry's own fields.
 */
type SceneHistoryDraft = {
  /** The adopted node before the carry, or null for a draft the carry created. */
  original: AnyNode | null
  parentIndex: number
  attachment: unknown
  /** Fields of the adopted node the carry holds: the value before its writes, and its value. */
  owned: Map<string, OwnedField>
  ended: boolean
}

/** Structural equality for node field values (plain data: arrays, objects, primitives). */
function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  const aKeys = Object.keys(a)
  const bKeys = Object.keys(b)
  if (aKeys.length !== bKeys.length) return false
  return aKeys.every((key) =>
    sameValue((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]),
  )
}

type OwnedField = { baseline: { present: boolean; value: unknown }; carried: unknown }

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
    owned: new Map(),
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

/**
 * Records a carry's own write: each field it changed on an adopted draft is held with the value
 * it had before (kept from an earlier carry write while the carry still held it) and the value
 * the carry wrote. A write back to that earlier value ends the hold.
 */
export function noteSceneHistoryDraftWrite(before: NodeMap, after: NodeMap): void {
  for (const [id, draft] of sceneHistoryDrafts) {
    const previous = before[id] as Record<string, unknown> | undefined
    const next = after[id] as Record<string, unknown> | undefined
    if (!(draft.original && previous && next) || previous === next) continue
    for (const key of new Set([...Object.keys(previous), ...Object.keys(next)])) {
      if (sameValue(previous[key], next[key])) continue
      const held = draft.owned.get(key)
      const baseline =
        held && sameValue(held.carried, previous[key])
          ? held.baseline
          : { present: Object.hasOwn(previous, key), value: previous[key] }
      if (baseline.present === Object.hasOwn(next, key) && sameValue(baseline.value, next[key])) {
        draft.owned.delete(key)
      } else {
        draft.owned.set(key, { baseline, carried: next[key] })
      }
    }
  }
}

/**
 * The fields the carry still holds on an adopted draft: those whose live value is still the
 * carry's. A foreign write over one ends the hold (until the carry writes it again).
 */
function heldFields(draft: SceneHistoryDraft, live: AnyNode): Array<[string, OwnedField]> {
  const values = live as unknown as Record<string, unknown>
  return [...draft.owned].filter(([key, field]) => sameValue(values[key], field.carried))
}

/**
 * Updates that put an adopted draft's held fields back to their values before the carry,
 * leaving everything others wrote. A parent that no longer exists is never restored.
 */
export function sceneHistoryDraftRevertUpdates(
  nodes: NodeMap,
  ids: Iterable<AnyNodeId>,
): Array<{ id: AnyNodeId; data: Record<string, unknown> }> {
  const updates: Array<{ id: AnyNodeId; data: Record<string, unknown> }> = []
  for (const id of ids) {
    const draft = sceneHistoryDrafts.get(id)
    const live = nodes[id]
    if (!(draft?.original && live)) continue
    const data: Record<string, unknown> = {}
    for (const [key, { baseline }] of heldFields(draft, live)) {
      if (key === 'parentId' && baseline.value && !nodes[baseline.value as AnyNodeId]) continue
      data[key] = baseline.present ? baseline.value : undefined
    }
    if (Object.keys(data).length > 0) updates.push({ id, data })
  }
  return updates
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
    const live = nodes[id]
    const held = draft.original && live ? heldFields(draft, live) : []
    if (!(draft.original && live) || held.length === 0) continue
    const heldParent = held.find(([key]) => key === 'parentId')?.[1].baseline
    const originalParentId = heldParent?.value as AnyNodeId | undefined
    const restoreParent =
      Boolean(heldParent) && (!originalParentId || Boolean(nodes[originalParentId]))
    const recorded = { ...live } as Record<string, unknown>
    for (const [key, { baseline }] of held) {
      if (key === 'parentId' && !restoreParent) continue
      if (baseline.present) recorded[key] = baseline.value
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
        originalParentId === draft.original.parentId ? draft.parentIndex : -1,
        originalParentId === draft.original.parentId ? draft.attachment : undefined,
      )
    }
  }
  return result ?? historyNodes
}

/**
 * After an undo or redo, puts back what the carry holds: a created draft (and its subtree)
 * whole, and on an adopted draft only its held fields, as they were just before the jump.
 * Everything else keeps the jumped-to state. Returns null when nothing needs restoring.
 */
export function withDraftsRestored(before: NodeMap, after: NodeMap): NodeMap | null {
  let result: NodeMap | null = null
  for (const [id, draft] of sceneHistoryDrafts) {
    const live = before[id]
    if (!live) continue
    if (draft.original) {
      const jumped = after[id]
      if (!jumped) continue
      const values = live as unknown as Record<string, unknown>
      const held = heldFields(draft, live)
        .map(([key]) => key)
        .filter(
          (key) => !sameValue(values[key], (jumped as unknown as Record<string, unknown>)[key]),
        )
      if (held.length === 0) continue
      result ??= { ...after }
      const restored = { ...jumped } as Record<string, unknown>
      for (const key of held) {
        if (Object.hasOwn(values, key)) restored[key] = values[key]
        else delete restored[key]
      }
      result[id] = restored as AnyNode
      const parentId = live.parentId as AnyNodeId | undefined
      if (held.includes('parentId') && parentId && result[parentId]) {
        const beforeParent = before[parentId]
        placeChild(
          result,
          id,
          jumped.parentId as AnyNodeId | undefined,
          parentId,
          childIdsOf(beforeParent).indexOf(id),
          attachmentsOf(beforeParent)?.[id],
        )
      }
      continue
    }
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

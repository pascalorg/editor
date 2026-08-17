import type { Collection, CollectionId } from '../schema/collections'
import type { Definition, DefinitionId } from '../schema/definitions'
import type { SavedView, SavedViewId } from '../schema/saved-views'
import type { SceneMaterial, SceneMaterialId } from '../schema/scene-material'
import type { AnyNode, AnyNodeId } from '../schema/types'
import type { SceneCommit, SceneSnapshot } from '../store/history-control'
import { subscribeSceneCommits } from '../store/history-control'

export type CollaborationStamp = {
  actorId: string
  clock: number
  operationId: string
}

type CollaborationRecordName = 'collections' | 'definitions' | 'materials' | 'savedViews'

export type CollaborationChange =
  | { type: 'node-create'; node: AnyNode; position: number }
  | { type: 'node-delete'; nodeId: AnyNodeId }
  | {
      type: 'node-fields'
      nodeId: AnyNodeId
      removed: string[]
      values: Record<string, unknown>
    }
  | {
      type: 'node-move'
      nodeId: AnyNodeId
      parentId: AnyNodeId | null
      position: number
    }
  | {
      type: 'record-set'
      record: CollaborationRecordName
      id: string
      value: unknown | null
    }
  | { type: 'installed-plugins-set'; value: string[] }

export type CollaborationBatch = CollaborationStamp & {
  protocol: 1
  changes: CollaborationChange[]
}

export type CollaborationConflict = {
  code: 'missing-parent' | 'parent-cycle'
  nodeId: AnyNodeId
  requestedParentId: AnyNodeId | null
}

export type CollaborationApplyResult = {
  snapshot: SceneSnapshot
  conflicts: CollaborationConflict[]
}

const NODE_IDENTITY_FIELDS = new Set(['id', 'object', 'type'])
const NODE_STRUCTURE_FIELDS = new Set(['children', 'parentId'])

function semanticEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true
  if (typeof left !== typeof right || left === null || right === null) return false
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!(Array.isArray(left) && Array.isArray(right)) || left.length !== right.length) return false
    return left.every((value, index) => semanticEqual(value, right[index]))
  }
  if (typeof left !== 'object' || typeof right !== 'object') return false

  const leftRecord = left as Record<string, unknown>
  const rightRecord = right as Record<string, unknown>
  const leftKeys = Object.keys(leftRecord)
  const rightKeys = Object.keys(rightRecord)
  if (leftKeys.length !== rightKeys.length) return false
  return leftKeys.every(
    (key) => Object.hasOwn(rightRecord, key) && semanticEqual(leftRecord[key], rightRecord[key]),
  )
}

function parentIdOf(node: AnyNode | undefined): AnyNodeId | null {
  return ((node?.parentId as AnyNodeId | null | undefined) ?? null) as AnyNodeId | null
}

function childIdsOf(node: AnyNode | undefined): AnyNodeId[] {
  if (!(node && 'children' in node && Array.isArray(node.children))) return []
  return node.children as AnyNodeId[]
}

function siblingIds(snapshot: SceneSnapshot, parentId: AnyNodeId | null): AnyNodeId[] {
  if (!parentId) return snapshot.rootNodeIds
  return childIdsOf(snapshot.nodes[parentId])
}

function nodePosition(snapshot: SceneSnapshot, nodeId: AnyNodeId): number {
  const node = snapshot.nodes[nodeId]
  if (!node) return -1
  return siblingIds(snapshot, parentIdOf(node)).indexOf(nodeId)
}

function sortedRecordKeys(left: Record<string, unknown>, right: Record<string, unknown>): string[] {
  return [...new Set([...Object.keys(left), ...Object.keys(right)])].sort()
}

function recordChanges(
  record: CollaborationRecordName,
  before: Record<string, unknown>,
  current: Record<string, unknown>,
): CollaborationChange[] {
  const changes: CollaborationChange[] = []
  for (const id of sortedRecordKeys(before, current)) {
    if (semanticEqual(before[id], current[id])) continue
    changes.push({
      type: 'record-set',
      record,
      id,
      value: Object.hasOwn(current, id) ? structuredClone(current[id]) : null,
    })
  }
  return changes
}

function nodeDepth(nodes: Record<AnyNodeId, AnyNode>, nodeId: AnyNodeId): number {
  let depth = 0
  let cursor = nodes[nodeId]
  const visited = new Set<AnyNodeId>()
  while (cursor) {
    const parentId = parentIdOf(cursor)
    if (!(parentId && nodes[parentId]) || visited.has(parentId)) break
    visited.add(parentId)
    cursor = nodes[parentId]
    depth += 1
  }
  return depth
}

export function createCollaborationBatch(
  before: SceneSnapshot,
  current: SceneSnapshot,
  stamp: CollaborationStamp,
): CollaborationBatch {
  const changes: CollaborationChange[] = []
  const beforeIds = new Set(Object.keys(before.nodes) as AnyNodeId[])
  const currentIds = new Set(Object.keys(current.nodes) as AnyNodeId[])

  const deletedIds = [...beforeIds]
    .filter((id) => !currentIds.has(id))
    .sort((left, right) => nodeDepth(before.nodes, right) - nodeDepth(before.nodes, left))
  for (const nodeId of deletedIds) changes.push({ type: 'node-delete', nodeId })

  const createdIds = [...currentIds]
    .filter((id) => !beforeIds.has(id))
    .sort((left, right) => nodeDepth(current.nodes, left) - nodeDepth(current.nodes, right))
  for (const id of createdIds) {
    changes.push({
      type: 'node-create',
      node: structuredClone(current.nodes[id] as AnyNode),
      position: Math.max(0, nodePosition(current, id)),
    })
  }

  const retainedIds = [...currentIds].filter((id) => beforeIds.has(id)).sort()
  for (const id of retainedIds) {
    const beforeNode = before.nodes[id] as AnyNode
    const currentNode = current.nodes[id] as AnyNode
    const values: Record<string, unknown> = {}
    const removed: string[] = []
    for (const field of sortedRecordKeys(
      beforeNode as Record<string, unknown>,
      currentNode as Record<string, unknown>,
    )) {
      if (NODE_IDENTITY_FIELDS.has(field) || NODE_STRUCTURE_FIELDS.has(field)) continue
      const beforeValue = (beforeNode as Record<string, unknown>)[field]
      const currentValue = (currentNode as Record<string, unknown>)[field]
      if (semanticEqual(beforeValue, currentValue)) continue
      if (Object.hasOwn(currentNode, field) && currentValue !== undefined) {
        values[field] = structuredClone(currentValue)
      } else {
        removed.push(field)
      }
    }
    if (Object.keys(values).length > 0 || removed.length > 0) {
      changes.push({ type: 'node-fields', nodeId: id, values, removed })
    }
  }

  const movedIds = retainedIds
    .filter(
      (id) =>
        parentIdOf(before.nodes[id]) !== parentIdOf(current.nodes[id]) ||
        nodePosition(before, id) !== nodePosition(current, id),
    )
    .sort((left, right) => {
      const leftParent = parentIdOf(current.nodes[left]) ?? ''
      const rightParent = parentIdOf(current.nodes[right]) ?? ''
      return (
        leftParent.localeCompare(rightParent) ||
        nodePosition(current, left) - nodePosition(current, right)
      )
    })
  for (const nodeId of movedIds) {
    changes.push({
      type: 'node-move',
      nodeId,
      parentId: parentIdOf(current.nodes[nodeId]),
      position: Math.max(0, nodePosition(current, nodeId)),
    })
  }

  changes.push(
    ...recordChanges('collections', before.collections, current.collections),
    ...recordChanges('savedViews', before.savedViews, current.savedViews),
    ...recordChanges('definitions', before.definitions, current.definitions),
    ...recordChanges('materials', before.materials, current.materials),
  )
  if (!semanticEqual(before.installedPlugins, current.installedPlugins)) {
    changes.push({ type: 'installed-plugins-set', value: [...current.installedPlugins] })
  }

  return { ...stamp, protocol: 1, changes }
}

function cloneSnapshot(snapshot: SceneSnapshot): SceneSnapshot {
  return structuredClone(snapshot)
}

function removeFromParent(snapshot: SceneSnapshot, nodeId: AnyNodeId): void {
  const node = snapshot.nodes[nodeId]
  if (!node) return
  const parentId = parentIdOf(node)
  if (!parentId) {
    snapshot.rootNodeIds = snapshot.rootNodeIds.filter((id) => id !== nodeId)
    return
  }
  const parent = snapshot.nodes[parentId]
  if (!(parent && 'children' in parent && Array.isArray(parent.children))) return
  snapshot.nodes[parentId] = {
    ...parent,
    children: (parent.children as AnyNodeId[]).filter((id) => id !== nodeId),
  } as AnyNode
}

function createsParentCycle(
  nodes: Record<AnyNodeId, AnyNode>,
  nodeId: AnyNodeId,
  parentId: AnyNodeId,
): boolean {
  let cursor: AnyNodeId | null = parentId
  const visited = new Set<AnyNodeId>()
  while (cursor) {
    if (cursor === nodeId) return true
    if (visited.has(cursor)) return true
    visited.add(cursor)
    cursor = parentIdOf(nodes[cursor])
  }
  return false
}

function insertIntoParent(
  snapshot: SceneSnapshot,
  nodeId: AnyNodeId,
  requestedParentId: AnyNodeId | null,
  position: number,
  conflicts: CollaborationConflict[],
): void {
  const node = snapshot.nodes[nodeId]
  if (!node) return
  removeFromParent(snapshot, nodeId)

  let parentId = requestedParentId
  if (parentId && !snapshot.nodes[parentId]) {
    conflicts.push({ code: 'missing-parent', nodeId, requestedParentId: parentId })
    parentId = null
  } else if (parentId && createsParentCycle(snapshot.nodes, nodeId, parentId)) {
    conflicts.push({ code: 'parent-cycle', nodeId, requestedParentId: parentId })
    parentId = null
  }

  snapshot.nodes[nodeId] = { ...node, parentId } as AnyNode
  if (!parentId) {
    const roots = snapshot.rootNodeIds.filter((id) => id !== nodeId)
    roots.splice(Math.min(Math.max(0, position), roots.length), 0, nodeId)
    snapshot.rootNodeIds = roots
    return
  }

  const parent = snapshot.nodes[parentId]
  if (!(parent && 'children' in parent && Array.isArray(parent.children))) {
    conflicts.push({ code: 'missing-parent', nodeId, requestedParentId: parentId })
    snapshot.nodes[nodeId] = { ...snapshot.nodes[nodeId], parentId: null } as AnyNode
    snapshot.rootNodeIds.push(nodeId)
    return
  }
  const children = (parent.children as AnyNodeId[]).filter((id) => id !== nodeId)
  children.splice(Math.min(Math.max(0, position), children.length), 0, nodeId)
  snapshot.nodes[parentId] = { ...parent, children } as AnyNode
}

function normalizeStructure(snapshot: SceneSnapshot): void {
  const seen = new Set<AnyNodeId>()
  snapshot.rootNodeIds = snapshot.rootNodeIds.filter((id) => {
    if (!(snapshot.nodes[id] && parentIdOf(snapshot.nodes[id]) === null) || seen.has(id))
      return false
    seen.add(id)
    return true
  })

  for (const [rawId, node] of Object.entries(snapshot.nodes)) {
    const id = rawId as AnyNodeId
    if (!('children' in node && Array.isArray(node.children))) continue
    const localSeen = new Set<AnyNodeId>()
    const children = (node.children as AnyNodeId[]).filter((childId) => {
      if (
        localSeen.has(childId) ||
        !snapshot.nodes[childId] ||
        parentIdOf(snapshot.nodes[childId]) !== id
      ) {
        return false
      }
      localSeen.add(childId)
      return true
    })
    snapshot.nodes[id] = { ...node, children } as AnyNode
  }

  for (const id of Object.keys(snapshot.nodes).sort() as AnyNodeId[]) {
    const node = snapshot.nodes[id] as AnyNode
    const parentId = parentIdOf(node)
    if (!parentId) {
      if (!seen.has(id)) {
        snapshot.rootNodeIds.push(id)
        seen.add(id)
      }
      continue
    }
    const parent = snapshot.nodes[parentId]
    if (!(parent && 'children' in parent && Array.isArray(parent.children))) {
      snapshot.nodes[id] = { ...node, parentId: null } as AnyNode
      if (!seen.has(id)) snapshot.rootNodeIds.push(id)
      seen.add(id)
      continue
    }
    if (!(parent.children as AnyNodeId[]).includes(id)) {
      snapshot.nodes[parentId] = {
        ...parent,
        children: [...(parent.children as AnyNodeId[]), id],
      } as AnyNode
    }
  }
}

function mutableRecord(
  snapshot: SceneSnapshot,
  record: CollaborationRecordName,
): Record<string, unknown> {
  return snapshot[record] as Record<string, unknown>
}

export function applyCollaborationBatch(
  baseline: SceneSnapshot,
  batch: CollaborationBatch,
): CollaborationApplyResult {
  const snapshot = cloneSnapshot(baseline)
  const conflicts: CollaborationConflict[] = []
  const deletes = new Set(
    batch.changes
      .filter(
        (change): change is Extract<CollaborationChange, { type: 'node-delete' }> =>
          change.type === 'node-delete',
      )
      .map((change) => change.nodeId),
  )

  if (deletes.size > 0) {
    const formerParents = new Map<AnyNodeId, AnyNodeId | null>()
    for (const id of deletes) formerParents.set(id, parentIdOf(snapshot.nodes[id]))
    for (const id of deletes) {
      removeFromParent(snapshot, id)
      delete snapshot.nodes[id]
    }
    for (const node of Object.values(snapshot.nodes)) {
      let parentId = parentIdOf(node)
      if (!(parentId && deletes.has(parentId))) continue
      const visited = new Set<AnyNodeId>()
      while (parentId && deletes.has(parentId) && !visited.has(parentId)) {
        visited.add(parentId)
        parentId = formerParents.get(parentId) ?? null
      }
      insertIntoParent(snapshot, node.id, parentId, Number.MAX_SAFE_INTEGER, conflicts)
    }
  }

  for (const change of batch.changes) {
    if (change.type !== 'node-create') continue
    const node = structuredClone(change.node)
    const requestedParentId = parentIdOf(node)
    removeFromParent(snapshot, node.id)
    if ('children' in node && Array.isArray(node.children)) {
      ;(node as Record<string, unknown>).children = []
    }
    snapshot.nodes[node.id] = { ...node, parentId: null } as AnyNode
    insertIntoParent(snapshot, node.id, requestedParentId, change.position, conflicts)
  }

  for (const change of batch.changes) {
    if (change.type === 'node-fields') {
      const node = snapshot.nodes[change.nodeId]
      if (!node) continue
      const next = { ...node } as Record<string, unknown>
      for (const [field, value] of Object.entries(change.values)) {
        if (NODE_IDENTITY_FIELDS.has(field) || NODE_STRUCTURE_FIELDS.has(field)) continue
        next[field] = structuredClone(value)
      }
      for (const field of change.removed) {
        if (!(NODE_IDENTITY_FIELDS.has(field) || NODE_STRUCTURE_FIELDS.has(field)))
          delete next[field]
      }
      snapshot.nodes[change.nodeId] = next as AnyNode
    } else if (change.type === 'node-move') {
      insertIntoParent(snapshot, change.nodeId, change.parentId, change.position, conflicts)
    } else if (change.type === 'record-set') {
      const record = mutableRecord(snapshot, change.record)
      if (change.value === null) delete record[change.id]
      else record[change.id] = structuredClone(change.value)
    } else if (change.type === 'installed-plugins-set') {
      snapshot.installedPlugins = [...change.value]
    }
  }

  normalizeStructure(snapshot)
  return { snapshot, conflicts }
}

function compareBatches(left: CollaborationBatch, right: CollaborationBatch): number {
  return (
    left.clock - right.clock ||
    left.actorId.localeCompare(right.actorId) ||
    left.operationId.localeCompare(right.operationId)
  )
}

export class SceneCollaborationDocument {
  readonly #baseline: SceneSnapshot
  readonly #batches = new Map<string, CollaborationBatch>()

  constructor(baseline: SceneSnapshot) {
    this.#baseline = cloneSnapshot(baseline)
  }

  merge(batch: CollaborationBatch): CollaborationApplyResult {
    const key = `${batch.actorId}\u0000${batch.operationId}`
    if (!this.#batches.has(key)) this.#batches.set(key, structuredClone(batch))
    return this.materialize()
  }

  materialize(): CollaborationApplyResult {
    let result: CollaborationApplyResult = {
      snapshot: cloneSnapshot(this.#baseline),
      conflicts: [],
    }
    for (const batch of [...this.#batches.values()].sort(compareBatches)) {
      const next = applyCollaborationBatch(result.snapshot, batch)
      result = { snapshot: next.snapshot, conflicts: [...result.conflicts, ...next.conflicts] }
    }
    return result
  }
}

function copyRecordValue(
  target: Record<string, unknown>,
  replacement: Record<string, unknown>,
  id: string,
): void {
  if (Object.hasOwn(replacement, id)) target[id] = structuredClone(replacement[id])
  else delete target[id]
}

function selectiveHistoryTarget(
  current: SceneSnapshot,
  expected: SceneSnapshot,
  replacement: SceneSnapshot,
): SceneSnapshot {
  const target = cloneSnapshot(current)
  const nodeIds = sortedRecordKeys(expected.nodes, replacement.nodes) as AnyNodeId[]

  for (const id of nodeIds) {
    const expectedNode = expected.nodes[id]
    const replacementNode = replacement.nodes[id]
    const currentNode = target.nodes[id]
    if (expectedNode && !replacementNode) {
      if (currentNode) delete target.nodes[id]
      continue
    }
    if (!expectedNode && replacementNode) {
      if (!currentNode) target.nodes[id] = structuredClone(replacementNode)
      continue
    }
    if (!(expectedNode && replacementNode && currentNode)) continue

    const next = { ...currentNode } as Record<string, unknown>
    for (const field of sortedRecordKeys(
      expectedNode as Record<string, unknown>,
      replacementNode as Record<string, unknown>,
    )) {
      if (NODE_IDENTITY_FIELDS.has(field) || NODE_STRUCTURE_FIELDS.has(field)) continue
      const expectedValue = (expectedNode as Record<string, unknown>)[field]
      if (!semanticEqual((currentNode as Record<string, unknown>)[field], expectedValue)) continue
      if (Object.hasOwn(replacementNode, field)) {
        next[field] = structuredClone((replacementNode as Record<string, unknown>)[field])
      } else {
        delete next[field]
      }
    }
    target.nodes[id] = next as AnyNode

    const expectedParent = parentIdOf(expectedNode)
    const replacementParent = parentIdOf(replacementNode)
    const expectedPosition = nodePosition(expected, id)
    if (
      (expectedParent !== replacementParent ||
        expectedPosition !== nodePosition(replacement, id)) &&
      parentIdOf(currentNode) === expectedParent &&
      nodePosition(current, id) === expectedPosition
    ) {
      insertIntoParent(
        target,
        id,
        replacementParent,
        Math.max(0, nodePosition(replacement, id)),
        [],
      )
    }
  }

  for (const recordName of ['collections', 'savedViews', 'definitions', 'materials'] as const) {
    const currentRecord = target[recordName] as Record<string, unknown>
    const expectedRecord = expected[recordName] as Record<string, unknown>
    const replacementRecord = replacement[recordName] as Record<string, unknown>
    for (const id of sortedRecordKeys(expectedRecord, replacementRecord)) {
      if (!semanticEqual(currentRecord[id], expectedRecord[id])) continue
      copyRecordValue(currentRecord, replacementRecord, id)
    }
  }
  if (semanticEqual(target.installedPlugins, expected.installedPlugins)) {
    target.installedPlugins = [...replacement.installedPlugins]
  }

  normalizeStructure(target)
  return target
}

type CollaborationHistoryEntry = { before: SceneSnapshot; current: SceneSnapshot }

export class ActorCollaborationHistory {
  readonly #actorId: string
  readonly #past: CollaborationHistoryEntry[] = []
  readonly #future: CollaborationHistoryEntry[] = []

  constructor(actorId: string) {
    this.#actorId = actorId
  }

  get canUndo(): boolean {
    return this.#past.length > 0
  }

  get canRedo(): boolean {
    return this.#future.length > 0
  }

  record(commit: Pick<SceneCommit, 'before' | 'current'>): void {
    if (semanticEqual(commit.before, commit.current)) return
    this.#past.push({
      before: cloneSnapshot(commit.before),
      current: cloneSnapshot(commit.current),
    })
    if (this.#past.length > 50) this.#past.shift()
    this.#future.length = 0
  }

  undo(
    current: SceneSnapshot,
    stamp: Omit<CollaborationStamp, 'actorId'>,
  ): { batch: CollaborationBatch; snapshot: SceneSnapshot } | null {
    const entry = this.#past.pop()
    if (!entry) return null
    const snapshot = selectiveHistoryTarget(current, entry.current, entry.before)
    const batch = createCollaborationBatch(current, snapshot, { ...stamp, actorId: this.#actorId })
    this.#future.push(entry)
    return batch.changes.length > 0 ? { batch, snapshot } : null
  }

  redo(
    current: SceneSnapshot,
    stamp: Omit<CollaborationStamp, 'actorId'>,
  ): { batch: CollaborationBatch; snapshot: SceneSnapshot } | null {
    const entry = this.#future.pop()
    if (!entry) return null
    const snapshot = selectiveHistoryTarget(current, entry.before, entry.current)
    const batch = createCollaborationBatch(current, snapshot, { ...stamp, actorId: this.#actorId })
    this.#past.push(entry)
    return batch.changes.length > 0 ? { batch, snapshot } : null
  }
}

export function subscribeCollaborationCommits(
  getCurrentSnapshot: () => SceneSnapshot,
  listener: (commit: SceneCommit) => void,
): () => void {
  let before: SceneSnapshot | null = null
  let scheduled = false
  let active = true

  const flush = () => {
    scheduled = false
    if (!(active && before)) return
    const commit = { origin: 'local' as const, before, current: getCurrentSnapshot() }
    before = null
    listener(commit)
  }

  const unsubscribe = subscribeSceneCommits((commit) => {
    if (commit.origin !== 'local') return
    before ??= commit.before
    if (scheduled) return
    scheduled = true
    queueMicrotask(flush)
  })

  return () => {
    active = false
    before = null
    unsubscribe()
  }
}

export type CollaborationSnapshotRecords = {
  collections?: Record<CollectionId, Collection>
  savedViews?: Record<SavedViewId, SavedView>
  definitions?: Record<DefinitionId, Definition>
  materials?: Record<SceneMaterialId, SceneMaterial>
  installedPlugins?: string[]
}

export function collaborationSnapshot(
  nodes: Record<AnyNodeId, AnyNode>,
  rootNodeIds: AnyNodeId[],
  records: CollaborationSnapshotRecords = {},
): SceneSnapshot {
  return {
    nodes,
    rootNodeIds,
    collections: records.collections ?? {},
    savedViews: records.savedViews ?? {},
    definitions: records.definitions ?? {},
    materials: records.materials ?? {},
    installedPlugins: records.installedPlugins ?? [],
  }
}

export { canonicalJson, hashModelSnapshot, sha256Hex } from './model-signature'

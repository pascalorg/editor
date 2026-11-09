import type { AnyNode, AnyNodeId, Collection } from '../schema'
import type { SceneSnapshot } from '../store/history-control'
import {
  nextSceneOperationState,
  type SceneCollectionPatch,
  type SceneNodeStructuralPatch,
  type SceneOperationPatch,
} from '../store/use-scene'
import { type Dependency, levelOf, queryIds } from './dependencies'
import { childIdsOf, fieldChanges, sameValue } from './patch'

/** Something that changed between a computation's base and the scene it is applied to. */
export type ChangedEntity = {
  kind:
    | 'node'
    | 'collection'
    | 'material'
    | 'plugins'
    | 'query'
    | 'order'
    | 'scope'
    | 'file'
    | 'artifact'
    | 'patch'
  /** The entity: a node, collection or material id, a query's entity, a scope's level. */
  id?: string
  field?: string
  /**
   * `dependency`: something the computation read is different now. `write`: something it writes
   * was also changed by someone else. `invalid`: the patch no longer applies at all.
   */
  reason: 'dependency' | 'write' | 'invalid'
}

/** Revisions the host looks up for `file` and `artifact` dependencies. */
export type ExternalRevisions = {
  fileUpdatedAt?(assetId: string): string | null
  artifactExists?(sha256: string): boolean
}

export type PatchApplication =
  | { ok: true; next: SceneSnapshot; patch: SceneOperationPatch }
  | { ok: false; changed: ChangedEntity[] }

type Doc = SceneSnapshot

const nodeOf = (doc: Doc, id: string) => doc.nodes[id as AnyNodeId] as AnyNode | undefined
const fieldOf = (node: AnyNode | undefined, field: string) =>
  node ? (node as Record<string, unknown>)[field] : undefined

/** Ids of nodes that differ between two documents (created, deleted or changed). */
function changedNodeIds(base: Doc, current: Doc): string[] {
  const ids: string[] = []
  for (const id of new Set([...Object.keys(base.nodes), ...Object.keys(current.nodes)])) {
    const before = nodeOf(base, id)
    const after = nodeOf(current, id)
    if (before !== after && !sameValue(before, after)) ids.push(id)
  }
  return ids
}

function ancestorIds(doc: Doc, id: string | undefined): string[] {
  const ids: string[] = []
  let parentId = id ? (nodeOf(doc, id)?.parentId as string | null | undefined) : null
  while (parentId && !ids.includes(parentId)) {
    ids.push(parentId)
    parentId = nodeOf(doc, parentId)?.parentId as string | null | undefined
  }
  return ids
}

function documentChanged(base: Doc, current: Doc): boolean {
  return (
    changedNodeIds(base, current).length > 0 ||
    !sameValue(base.rootNodeIds, current.rootNodeIds) ||
    !sameValue(base.collections, current.collections) ||
    !sameValue(base.materials, current.materials) ||
    !sameValue(base.installedPlugins, current.installedPlugins)
  )
}

function dependencyChanges(
  dependency: Dependency,
  base: Doc,
  current: Doc,
  external: ExternalRevisions,
  changedIds: () => string[],
): ChangedEntity[] {
  const changed = (entity: Omit<ChangedEntity, 'reason'>): ChangedEntity[] => [
    { ...entity, reason: 'dependency' },
  ]
  switch (dependency.kind) {
    case 'node': {
      const before = nodeOf(base, dependency.id)
      const after = nodeOf(current, dependency.id)
      if (!before !== !after) return changed({ kind: 'node', id: dependency.id })
      return dependency.fields.flatMap((field) =>
        sameValue(fieldOf(before, field), fieldOf(after, field))
          ? []
          : changed({ kind: 'node', id: dependency.id, field }),
      )
    }
    case 'query':
      return sameValue(queryIds(base, dependency), queryIds(current, dependency))
        ? []
        : changed({ kind: 'query', id: dependency.entity })
    case 'order':
      return sameValue(
        childIdsOf(nodeOf(base, dependency.parentId)),
        childIdsOf(nodeOf(current, dependency.parentId)),
      )
        ? []
        : changed({ kind: 'order', id: dependency.parentId })
    case 'collection': {
      const before = base.collections[dependency.id as Collection['id']]
      const after = current.collections[dependency.id as Collection['id']]
      if (!before !== !after) return changed({ kind: 'collection', id: dependency.id })
      return dependency.fields.flatMap((field) =>
        sameValue(
          (before as Record<string, unknown> | undefined)?.[field],
          (after as Record<string, unknown> | undefined)?.[field],
        )
          ? []
          : changed({ kind: 'collection', id: dependency.id, field }),
      )
    }
    case 'material':
      return sameValue(
        base.materials[dependency.id as keyof Doc['materials']],
        current.materials[dependency.id as keyof Doc['materials']],
      )
        ? []
        : changed({ kind: 'material', id: dependency.id })
    case 'plugins':
      return sameValue(base.installedPlugins, current.installedPlugins) &&
        (base.hasExplicitPluginInstallState ?? false) ===
          (current.hasExplicitPluginInstallState ?? false)
        ? []
        : changed({ kind: 'plugins' })
    case 'file':
      return external.fileUpdatedAt?.(dependency.assetId) === dependency.updatedAt
        ? []
        : changed({ kind: 'file', id: dependency.assetId })
    case 'artifact':
      return external.artifactExists?.(dependency.sha256)
        ? []
        : changed({ kind: 'artifact', id: dependency.sha256 })
    case 'scope': {
      if (dependency.whole) return documentChanged(base, current) ? changed({ kind: 'scope' }) : []
      const level = dependency.level
      // The level's own content, and what it stands on: its building and site (transforms,
      // sculpted terrain) reach every support answer on it.
      const ancestors = new Set([...ancestorIds(base, level), ...ancestorIds(current, level)])
      const touched = changedIds().some(
        (id) =>
          id === level ||
          ancestors.has(id) ||
          levelOf(base.nodes, id) === level ||
          levelOf(current.nodes, id) === level,
      )
      return touched ? changed({ kind: 'scope', id: level }) : []
    }
  }
}

function writeChanges(patch: SceneOperationPatch, base: Doc, current: Doc): ChangedEntity[] {
  const changed: ChangedEntity[] = []
  const write = (entity: Omit<ChangedEntity, 'reason'>) =>
    changed.push({ ...entity, reason: 'write' })
  const createdIds = new Set(patch.nodeCreates.map(({ node }) => node.id as string))

  for (const { id, data, removeFields } of patch.nodeUpdates) {
    const before = nodeOf(base, id)
    const after = nodeOf(current, id)
    if (!after) {
      write({ kind: 'node', id })
      continue
    }
    const written: Record<string, unknown> = { ...data }
    for (const field of removeFields) written[field] = undefined
    for (const [field, value] of Object.entries(written)) {
      const theirs = fieldOf(after, field)
      if (!sameValue(fieldOf(before, field), theirs) && !sameValue(theirs, value))
        write({ kind: 'node', id, field })
    }
  }
  for (const { node } of patch.nodeDeletes) {
    const after = nodeOf(current, node.id)
    if (!after || !sameValue(nodeOf(base, node.id), after)) write({ kind: 'node', id: node.id })
  }
  for (const { node } of patch.nodeCreates) {
    if (nodeOf(current, node.id)) write({ kind: 'node', id: node.id })
    const parentId = node.parentId as string | null | undefined
    if (parentId && !createdIds.has(parentId) && !nodeOf(current, parentId))
      write({ kind: 'node', id: parentId })
  }
  for (const { id, collection } of patch.collectionChanges ?? []) {
    const before = base.collections[id]
    const after = current.collections[id]
    if (collection === null || !before) {
      if (!sameValue(before, after) && !sameValue(after, collection))
        write({ kind: 'collection', id })
      continue
    }
    if (!after) {
      write({ kind: 'collection', id })
      continue
    }
    const { data, removeFields } = fieldChanges(before, collection)
    const written: Record<string, unknown> = { ...data }
    for (const field of removeFields) written[field] = undefined
    for (const [field, value] of Object.entries(written)) {
      const theirs = (after as Record<string, unknown>)[field]
      if (
        !sameValue((before as Record<string, unknown>)[field], theirs) &&
        !sameValue(theirs, value)
      )
        write({ kind: 'collection', id, field })
    }
  }
  for (const { id, material } of patch.materialChanges) {
    const after = current.materials[id]
    if (!sameValue(base.materials[id], after) && !sameValue(after, material ?? undefined))
      write({ kind: 'material', id })
  }
  if (
    (patch.pluginInstallState || patch.pluginChanges?.length) &&
    !sameValue(base.installedPlugins, current.installedPlugins)
  )
    write({ kind: 'plugins' })
  return changed
}

/**
 * Where a patch's created siblings go among `currentSiblings`: each after the sibling it followed
 * in the patch's own result (the nearest earlier one still there), so creates made independently
 * on the same parent all keep their place.
 */
function rebasedCreates(
  intended: readonly string[],
  currentSiblings: readonly string[],
  creates: readonly SceneNodeStructuralPatch[],
): SceneNodeStructuralPatch[] {
  const created = new Set(creates.map(({ node }) => node.id as string))
  const present = new Set(currentSiblings)
  const after = new Map<string | null, string[]>()
  let anchor: string | null = null
  for (const id of intended) {
    if (created.has(id)) {
      const list = after.get(anchor) ?? []
      list.push(id)
      after.set(anchor, list)
    } else if (present.has(id)) anchor = id
  }
  const final = [...(after.get(null) ?? [])]
  for (const id of currentSiblings) final.push(id, ...(after.get(id) ?? []))
  return creates.map((create) => ({ node: create.node, position: final.indexOf(create.node.id) }))
}

/** The patch with its structural positions and collection writes moved onto `current`. */
function rebase(patch: SceneOperationPatch, base: Doc, current: Doc): SceneOperationPatch {
  const deleted = new Set(patch.nodeDeletes.map(({ node }) => node.id as string))
  const created = new Set(patch.nodeCreates.map(({ node }) => node.id as string))
  const childUpdates = new Map(
    patch.nodeUpdates.flatMap(({ id, data }) =>
      'children' in data ? [[id as string, data.children as unknown as string[]] as const] : [],
    ),
  )
  const siblingsOf = (doc: Doc, parentId: string | null) =>
    (parentId ? childIdsOf(nodeOf(doc, parentId)) : doc.rootNodeIds) as string[]

  const nodeDeletes = patch.nodeDeletes.map(({ node }) => {
    const theirs = nodeOf(current, node.id)!
    const parentId = (theirs.parentId as string | null | undefined) ?? null
    return { node: theirs, position: siblingsOf(current, parentId).indexOf(node.id) }
  })

  const createsByParent = new Map<string | null, SceneNodeStructuralPatch[]>()
  const nodeCreates: SceneNodeStructuralPatch[] = []
  for (const create of patch.nodeCreates) {
    const parentId = (create.node.parentId as string | null | undefined) ?? null
    if (parentId && created.has(parentId)) {
      nodeCreates.push(create)
      continue
    }
    const list = createsByParent.get(parentId) ?? []
    list.push(create)
    createsByParent.set(parentId, list)
  }
  for (const [parentId, creates] of createsByParent) {
    const reordered = parentId ? childUpdates.get(parentId) : undefined
    const kept = (siblings: string[]) => reordered ?? siblings.filter((id) => !deleted.has(id))
    const intended = [...kept(siblingsOf(base, parentId))]
    for (const create of [...creates].sort((a, b) => a.position - b.position))
      intended.splice(create.position, 0, create.node.id)
    nodeCreates.push(...rebasedCreates(intended, kept(siblingsOf(current, parentId)), creates))
  }

  const collectionChanges: SceneCollectionPatch[] = (patch.collectionChanges ?? []).map(
    ({ id, collection }) => {
      const before = base.collections[id]
      const after = current.collections[id]
      if (!(collection && before && after)) return { id, collection }
      const { data, removeFields } = fieldChanges(before, collection)
      const merged: Record<string, unknown> = { ...after, ...data }
      for (const field of removeFields) delete merged[field]
      return { id, collection: merged as Collection }
    },
  )

  return {
    ...patch,
    nodeCreates,
    nodeDeletes,
    ...(patch.collectionChanges ? { collectionChanges } : {}),
  }
}

/**
 * Applies a patch computed from `baseDoc` to `current`, the scene as it is now, or says what
 * changed meanwhile so it cannot be:
 *
 * - every dependency (field, query membership with absent matches, order, collection, material,
 *   plugins, file, artifact, scope) is compared between `baseDoc` and `current`;
 * - every field the patch writes must not have been changed meanwhile to another value;
 * - otherwise the patch lands field by field: other fields others changed on the same node or
 *   collection are kept, and a parent's children created independently keep their place.
 *
 * Returns the next document and the patch rebased onto `current` (what an editor applies).
 */
export function applyPatchWithDependencies(
  current: SceneSnapshot,
  patch: SceneOperationPatch,
  dependencies: readonly Dependency[],
  baseDoc: SceneSnapshot,
  external: ExternalRevisions = {},
): PatchApplication {
  let changedIds: string[] | null = null
  const lazyChangedIds = () => {
    changedIds ??= changedNodeIds(baseDoc, current)
    return changedIds
  }
  const changed = [
    ...dependencies.flatMap((dependency) =>
      dependencyChanges(dependency, baseDoc, current, external, lazyChangedIds),
    ),
    ...writeChanges(patch, baseDoc, current),
  ]
  if (changed.length) return { ok: false, changed: dedupe(changed) }
  const rebased = rebase(patch, baseDoc, current)
  const next = nextSceneOperationState(current, rebased)
  if (!next) return { ok: false, changed: [{ kind: 'patch', reason: 'invalid' }] }
  return { ok: true, next: { ...current, ...next }, patch: rebased }
}

function dedupe(changed: ChangedEntity[]): ChangedEntity[] {
  const seen = new Set<string>()
  return changed.filter((entity) => {
    const key = JSON.stringify(entity)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

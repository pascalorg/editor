import type { AnyNode, AnyNodeId, Collection } from '../schema'
import type { SceneSnapshot } from '../store/history-control'
import {
  nextSceneOperationState,
  type SceneCollectionPatch,
  type SceneMaterialPatch,
  type SceneNodePatch,
  type SceneNodeStructuralPatch,
  type SceneOperationPatch,
} from '../store/use-scene'

/** Structural equality of document values; a key holding `undefined` counts as absent. */
export function sameValue(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true
  if (typeof left !== typeof right || left === null || right === null) return false
  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((value, index) => sameValue(value, right[index]))
    )
  }
  if (typeof left !== 'object') return false
  const a = left as Record<string, unknown>
  const b = right as Record<string, unknown>
  const keys = new Set([...Object.keys(a), ...Object.keys(b)])
  for (const key of keys) if (!sameValue(a[key], b[key])) return false
  return true
}

export function childIdsOf(node: AnyNode | undefined): AnyNodeId[] {
  return node && 'children' in node && Array.isArray(node.children)
    ? (node.children as AnyNodeId[])
    : []
}

/** Where `node` sits among its siblings in `doc`: its parent's children, or the roots. */
function siblingPosition(doc: Pick<SceneSnapshot, 'nodes' | 'rootNodeIds'>, node: AnyNode) {
  const parentId = node.parentId as AnyNodeId | null | undefined
  const siblings = parentId ? childIdsOf(doc.nodes[parentId]) : doc.rootNodeIds
  return siblings.indexOf(node.id as AnyNodeId)
}

export class UnexpressiblePatchError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'UnexpressiblePatchError'
  }
}

/** The fields of `next` that differ from `base`, and those `next` no longer has. */
export function fieldChanges(
  base: Readonly<Record<string, unknown>>,
  next: Readonly<Record<string, unknown>>,
  ignore: readonly string[] = [],
): { data: Record<string, unknown>; removeFields: string[] } {
  const data: Record<string, unknown> = {}
  const removeFields: string[] = []
  for (const field of new Set([...Object.keys(base), ...Object.keys(next)])) {
    if (ignore.includes(field) || sameValue(base[field], next[field])) continue
    if (next[field] === undefined) removeFields.push(field)
    else data[field] = next[field]
  }
  return { data, removeFields }
}

const documentParts = (doc: SceneSnapshot) => ({
  nodes: doc.nodes,
  rootNodeIds: doc.rootNodeIds,
  collections: doc.collections,
  materials: doc.materials,
  installedPlugins: doc.installedPlugins,
})

/**
 * The patch that turns `base` into `next`, field by field: created nodes with the position they
 * take among their siblings, deleted nodes as they were and where, each changed node field (and
 * the fields removed), changed materials, collections and plugin state. A parent's `children` is
 * written only where creates and deletes do not already account for it (a reorder). The patch is
 * checked by applying it to `base`; one that does not land exactly on `next` (a reordering of the
 * roots, which a patch cannot express) throws `UnexpressiblePatchError`.
 */
export function diffSceneDocuments(base: SceneSnapshot, next: SceneSnapshot): SceneOperationPatch {
  const created = new Set<AnyNodeId>()
  const nodeCreates: SceneNodeStructuralPatch[] = []
  const nodeDeletes: SceneNodeStructuralPatch[] = []
  const nodeUpdates: SceneNodePatch[] = []
  for (const node of Object.values(next.nodes)) {
    if (base.nodes[node.id]) continue
    created.add(node.id)
    nodeCreates.push({ node, position: siblingPosition(next, node) })
  }
  for (const node of Object.values(base.nodes)) {
    if (!next.nodes[node.id]) nodeDeletes.push({ node, position: siblingPosition(base, node) })
  }
  const reordered: AnyNodeId[] = []
  for (const node of Object.values(next.nodes)) {
    const before = base.nodes[node.id]
    if (!before || before === node) continue
    const { data, removeFields } = fieldChanges(
      before as Record<string, unknown>,
      node as Record<string, unknown>,
      ['children'],
    )
    if (Object.keys(data).length || removeFields.length)
      nodeUpdates.push({ id: node.id, data: data as SceneNodePatch['data'], removeFields })
    if (!sameValue(childIdsOf(before), childIdsOf(node))) reordered.push(node.id)
  }

  const materialChanges: SceneMaterialPatch[] = []
  for (const id of new Set([...Object.keys(base.materials), ...Object.keys(next.materials)])) {
    const material = next.materials[id as keyof typeof next.materials]
    if (!sameValue(base.materials[id as keyof typeof base.materials], material))
      materialChanges.push({ id: id as SceneMaterialPatch['id'], material: material ?? null })
  }
  const collectionChanges: SceneCollectionPatch[] = []
  for (const id of new Set([...Object.keys(base.collections), ...Object.keys(next.collections)])) {
    const collection = next.collections[id as Collection['id']]
    if (!sameValue(base.collections[id as Collection['id']], collection))
      collectionChanges.push({ id: id as Collection['id'], collection: collection ?? null })
  }
  const pluginsChanged =
    !sameValue(base.installedPlugins, next.installedPlugins) ||
    (base.hasExplicitPluginInstallState ?? false) !== (next.hasExplicitPluginInstallState ?? false)

  const patch: SceneOperationPatch = {
    nodeCreates,
    nodeDeletes,
    nodeUpdates,
    materialChanges,
    ...(collectionChanges.length ? { collectionChanges } : {}),
    ...(pluginsChanged
      ? {
          pluginInstallState: {
            installedPlugins: [...next.installedPlugins],
            explicit: next.hasExplicitPluginInstallState ?? false,
          },
        }
      : {}),
  }

  // A parent's children follow from the creates and deletes, unless the order itself changed.
  if (reordered.length) {
    const landed = nextSceneOperationState(documentParts(base), patch)
    for (const id of reordered) {
      const children = childIdsOf(next.nodes[id])
      if (landed && sameValue(childIdsOf(landed.nodes[id]), children)) continue
      const kept = children.filter((child) => !created.has(child))
      const update = nodeUpdates.find((entry) => entry.id === id)
      if (update) (update.data as Record<string, unknown>).children = kept
      else
        nodeUpdates.push({
          id,
          data: { children: kept } as SceneNodePatch['data'],
          removeFields: [],
        })
    }
  }

  const landed = nextSceneOperationState(documentParts(base), patch)
  if (!landed) throw new UnexpressiblePatchError('The scene change does not apply to its base.')
  if (!sameValue(landed.rootNodeIds, next.rootNodeIds))
    throw new UnexpressiblePatchError('A scene patch cannot reorder the scene roots.')
  for (const id of new Set([...Object.keys(landed.nodes), ...Object.keys(next.nodes)])) {
    const key = id as AnyNodeId
    if (!sameValue(landed.nodes[key], next.nodes[key]))
      throw new UnexpressiblePatchError(`The scene patch does not reproduce node ${id}.`)
  }
  return patch
}

/** Whether a patch changes nothing. */
export function isEmptyScenePatch(patch: SceneOperationPatch): boolean {
  return (
    patch.nodeCreates.length === 0 &&
    patch.nodeDeletes.length === 0 &&
    patch.nodeUpdates.length === 0 &&
    patch.materialChanges.length === 0 &&
    !patch.collectionChanges?.length &&
    !patch.pluginChanges?.length &&
    !patch.pluginInstallState
  )
}

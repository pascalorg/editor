import { refuse } from '../agent-tools/refusal'
import {
  type AnyNodeId,
  COLLECTION_TEMPLATES,
  type Collection,
  type CollectionId,
  type CollectionTemplateId,
  generateCollectionId,
} from '../schema'
import { levelIdOf } from './scene-queries'
import type { AgentOperationOutcome, SceneChanges, SceneNodes } from './types'

/** What the collection tools read: the nodes and the scene's collections. */
export type CollectionScene = {
  nodes: SceneNodes
  collections: Readonly<Record<string, Collection>>
}

export type EditCollectionInput = {
  collectionId?: string
  template?: CollectionTemplateId
  name?: string
  color?: string
  add?: string[]
  remove?: string[]
  delete?: boolean
}

/** The scene's collections after `writes` (a surface applies `SceneChanges.collections` with it). */
export function writeCollections(
  current: Readonly<Record<string, Collection>>,
  writes: Readonly<Record<string, Collection | null>>,
): Record<CollectionId, Collection> {
  const next = { ...current } as Record<CollectionId, Collection>
  for (const [id, collection] of Object.entries(writes)) {
    if (collection) next[id as CollectionId] = collection
    else delete next[id as CollectionId]
  }
  return next
}

function describeCollection({ nodes }: CollectionScene, collection: Collection) {
  const elements = collection.nodeIds.flatMap((id) => {
    const node = nodes[id]
    if (!node) return []
    return [
      {
        id,
        name: node.name ?? (node.type === 'item' ? node.asset.name : undefined),
        type: node.type,
        levelId: levelIdOf(nodes, id),
      },
    ]
  })
  return {
    id: collection.id,
    name: collection.name,
    ...(collection.color ? { color: collection.color } : {}),
    ...(collection.template ? { template: collection.template } : {}),
    count: elements.length,
    elements,
  }
}

function collectionById({ collections }: CollectionScene, collectionId: string): Collection {
  const collection = collections[collectionId]
  if (!collection)
    refuse('collection_not_found', `Collection not found: ${collectionId}.`, { collectionId })
  return collection
}

/** Items mirror their membership in `collectionIds`, as the editor's own collection actions do. */
function itemMirrorUpdates(
  nodes: SceneNodes,
  collectionId: CollectionId,
  before: readonly AnyNodeId[],
  after: readonly AnyNodeId[],
): NonNullable<SceneChanges['update']> {
  const members = new Set(after)
  const updates: NonNullable<SceneChanges['update']> = []
  for (const id of new Set([...before, ...after])) {
    const node = nodes[id]
    if (node?.type !== 'item') continue
    const current = node.collectionIds ?? []
    if (current.includes(collectionId) === members.has(id)) continue
    updates.push({
      id,
      data: {
        collectionIds: members.has(id)
          ? [...current, collectionId]
          : current.filter((other) => other !== collectionId),
      },
    })
  }
  return updates
}

/**
 * `edit_collection`: one collection created, changed or deleted. Without an id the call works on
 * the scene's collection with the template, or else the name, and creates it when there is none.
 */
export function editCollection(
  scene: CollectionScene,
  input: EditCollectionInput,
): AgentOperationOutcome {
  const all = Object.values(scene.collections)
  const nameKey = input.name?.toLowerCase()
  const existing = input.collectionId
    ? collectionById(scene, input.collectionId)
    : input.template
      ? all.find((collection) => collection.template === input.template)
      : nameKey
        ? all.find((collection) => collection.name.toLowerCase() === nameKey)
        : refuse('collection_required', 'Pass a collectionId, a template or a name.')

  if (input.delete) {
    if (!existing)
      refuse('collection_not_found', `No collection named ${input.name ?? input.template}.`)
    return {
      result: { deletedId: existing.id, name: existing.name },
      changes: {
        collections: { [existing.id]: null },
        update: itemMirrorUpdates(scene.nodes, existing.id, existing.nodeIds, []),
      },
    }
  }

  const missing = (input.add ?? []).filter((id) => !scene.nodes[id])
  if (missing.length)
    refuse('node_not_found', `Not in the scene: ${missing.join(', ')}.`, { ids: missing })

  const preset = input.template ? COLLECTION_TEMPLATES[input.template] : undefined
  const base: Collection = existing ?? {
    id: generateCollectionId(),
    name: preset?.name ?? input.name!,
    ...(preset ? { color: preset.color } : {}),
    nodeIds: [],
  }
  const removed = new Set(input.remove ?? [])
  const nodeIds = [...new Set([...base.nodeIds, ...((input.add ?? []) as AnyNodeId[])])].filter(
    (id) => !removed.has(id),
  )
  const next: Collection = {
    ...base,
    ...(input.name ? { name: input.name } : {}),
    ...(input.color ? { color: input.color } : {}),
    ...(input.template ? { template: input.template } : {}),
    nodeIds,
  }
  return {
    result: { created: !existing, collection: describeCollection(scene, next) },
    changes: {
      collections: { [next.id]: next },
      update: itemMirrorUpdates(scene.nodes, next.id, base.nodeIds, nodeIds),
    },
  }
}

/** `list_collections`: the scene's collections with their elements, and the templates. */
export function listCollections(
  scene: CollectionScene,
  { collectionId }: { collectionId?: string },
): AgentOperationOutcome {
  const collections = collectionId
    ? [collectionById(scene, collectionId)]
    : Object.values(scene.collections)
  return {
    result: {
      count: collections.length,
      collections: collections.map((collection) => describeCollection(scene, collection)),
      templates: Object.entries(COLLECTION_TEMPLATES).map(([id, { name }]) => ({ id, name })),
    },
  }
}

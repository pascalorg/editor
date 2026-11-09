import { findLevelAncestorId } from '../lib/node-ancestry'
import type { AnyNode, AnyNodeId, Collection } from '../schema'

/** Nodes a query selects: every node, or those of a kind and/or under a parent (`null`: roots). */
export type NodePredicate = { type?: string | readonly string[]; parentId?: string | null }
/** Collections a query selects: by name (case-insensitive) and/or template. */
export type CollectionPredicate = { name?: string; template?: string }

export type EntityQuery =
  | { entity: 'node'; where?: NodePredicate }
  | { entity: 'collection'; where?: CollectionPredicate }
  | { entity: 'material' }
  | { entity: 'root' }

/**
 * What a computation read, recorded so a later apply can tell whether the scene it read still
 * holds. Every dependency is compared between the scene the computation started from and the
 * scene at apply time; any difference is a conflict.
 *
 * - `node`: the node's presence, and the fields read (top level; `[]` when only its presence was).
 * - `query`: the ids an entity query matched, absent matches included (`[]` when none did).
 * - `order`: a parent's children, in order, where the order was consumed.
 * - `collection`: a collection's presence and the fields read. `material`: a material's record.
 * - `plugins`: the installed plugin list. `file` and `artifact`: a project file at a revision,
 *   a stored artifact, declared by the host that read them.
 * - `scope`: a conservative fallback for reads the recorder cannot see: everything on a level,
 *   or the whole document.
 */
export type Dependency =
  | { kind: 'node'; id: string; fields: readonly string[] }
  | { kind: 'query'; entity: 'node'; predicate: NodePredicate | null; resultIds: readonly string[] }
  | {
      kind: 'query'
      entity: 'collection'
      predicate: CollectionPredicate | null
      resultIds: readonly string[]
    }
  | { kind: 'query'; entity: 'material' | 'root'; predicate: null; resultIds: readonly string[] }
  | { kind: 'order'; parentId: string; childIds: readonly string[] }
  | { kind: 'collection'; id: string; fields: readonly string[] }
  | { kind: 'material'; id: string }
  | { kind: 'plugins' }
  | { kind: 'file'; assetId: string; updatedAt: string }
  | { kind: 'artifact'; sha256: string }
  | { kind: 'scope'; level?: string; whole?: true }

export type QueryDependency = Extract<Dependency, { kind: 'query' }>

export function matchesNodePredicate(node: AnyNode, predicate: NodePredicate | null): boolean {
  if (!predicate) return true
  const { type, parentId } = predicate
  if (
    type !== undefined &&
    !(typeof type === 'string' ? node.type === type : type.includes(node.type))
  )
    return false
  if (parentId !== undefined && (node.parentId ?? null) !== parentId) return false
  return true
}

export function matchesCollectionPredicate(
  collection: Collection,
  predicate: CollectionPredicate | null,
): boolean {
  if (!predicate) return true
  if (
    predicate.name !== undefined &&
    collection.name.toLowerCase() !== predicate.name.toLowerCase()
  )
    return false
  if (predicate.template !== undefined && collection.template !== predicate.template) return false
  return true
}

/** The ids `query` selects in `doc`, in the document's own order. */
/** The parts of a document queries read. */
export type DocumentParts = {
  nodes: Readonly<Record<string, AnyNode>>
  collections: Readonly<Record<string, Collection>>
  materials: Readonly<Record<string, unknown>>
  rootNodeIds: readonly string[]
}

export function queryIds(
  doc: DocumentParts,
  query: Pick<QueryDependency, 'entity' | 'predicate'>,
): string[] {
  switch (query.entity) {
    case 'node':
      return Object.values(doc.nodes)
        .filter((node) => matchesNodePredicate(node, query.predicate as NodePredicate | null))
        .map((node) => node.id)
    case 'collection':
      return Object.values(doc.collections)
        .filter((collection) =>
          matchesCollectionPredicate(collection, query.predicate as CollectionPredicate | null),
        )
        .map((collection) => collection.id)
    case 'material':
      return Object.keys(doc.materials)
    case 'root':
      return [...doc.rootNodeIds]
  }
}

/** The level a node belongs to in `nodes`, or null outside every level. */
export function levelOf(nodes: Readonly<Record<string, AnyNode>>, id: string): string | null {
  return findLevelAncestorId(id as AnyNodeId, nodes as Record<string, AnyNode>)
}

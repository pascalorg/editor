import type { SceneNodes } from '../agent-operations/types'
import type { AnyNode, Collection } from '../schema'
import {
  type CollectionPredicate,
  matchesCollectionPredicate,
  matchesNodePredicate,
  type NodePredicate,
} from './dependencies'
import { readerOf } from './reader'

/**
 * The nodes `where` selects, in scene order. On a detached scene this records the selection (its
 * members, absent ones included) instead of a read of every node, so an unrelated node created
 * meanwhile does not invalidate the operation.
 */
export function queryNodes<T extends AnyNode = AnyNode>(
  nodes: SceneNodes,
  where: NodePredicate & { type?: T['type'] | readonly T['type'][] },
): T[] {
  const reader = readerOf(nodes)
  if (reader) return reader.query({ entity: 'node', where }) as T[]
  return Object.values(nodes).filter((node) => matchesNodePredicate(node, where)) as T[]
}

/** A node's children in order, recorded as an ordered read: for results that depend on order. */
export function orderedChildIds(nodes: SceneNodes, id: string): string[] {
  const reader = readerOf(nodes)
  if (reader) return reader.orderedChildren(id)
  const node = nodes[id]
  return node && 'children' in node && Array.isArray(node.children)
    ? (node.children as unknown[]).filter((child): child is string => typeof child === 'string')
    : []
}

/** The collections `where` selects (by name, case-insensitive, or template), recorded like `queryNodes`. */
export function queryCollections(
  collections: Readonly<Record<string, Collection>>,
  where: CollectionPredicate,
): Collection[] {
  const reader = readerOf(collections)
  if (reader) return reader.query({ entity: 'collection', where })
  return Object.values(collections).filter((collection) =>
    matchesCollectionPredicate(collection, where),
  )
}

import type { Collection, CollectionId } from '../schema/collections'
import type { AnyNodeId } from '../schema/types'

/**
 * Effective visibility and lock for a node, resolved from the collections it
 * belongs to.
 *
 * Membership is read from `collection.nodeIds` rather than the `collectionIds`
 * stamped onto each node. That denormalised field is an index, and only the
 * `item` schema declares it — every other kind has it stripped by the next
 * `parse()`, so it cannot be trusted as a source of truth. `collections` is
 * what actually round-trips through save / load / clone / fork.
 *
 * Both rules are deliberately one-directional:
 *
 * - **Hidden wins.** Being in any hidden collection hides the node. A node in
 *   two collections is in both, so the stricter answer is the only one that
 *   can't surprise — unhiding one collection must not reveal something the
 *   other is still hiding.
 * - **Locked wins**, for the same reason.
 */
export type CollectionMembershipIndex = {
  hidden: Set<AnyNodeId>
  locked: Set<AnyNodeId>
}

const EMPTY_INDEX: CollectionMembershipIndex = { hidden: new Set(), locked: new Set() }

// Keyed on the `collections` object itself. Renderers call this from inside a
// store selector, which re-runs on *every* scene mutation — without this, a node
// drag would mint a fresh index each frame and every subscriber would see a new
// reference and re-render. `collections` only changes identity when a collection
// actually changes, so the cache turns that into one build per real change.
const indexCache = new WeakMap<object, CollectionMembershipIndex>()

/**
 * Build the node sets once per `collections` change, so per-node lookups during
 * a render stay O(1) instead of walking every collection for every node.
 */
export function buildCollectionMembershipIndex(
  collections: Readonly<Record<CollectionId, Collection>>,
): CollectionMembershipIndex {
  const cached = indexCache.get(collections)
  if (cached) return cached
  const built = computeCollectionMembershipIndex(collections)
  indexCache.set(collections, built)
  return built
}

function computeCollectionMembershipIndex(
  collections: Readonly<Record<CollectionId, Collection>>,
): CollectionMembershipIndex {
  let hidden: Set<AnyNodeId> | null = null
  let locked: Set<AnyNodeId> | null = null

  for (const collection of Object.values(collections)) {
    if (collection.visible === false) {
      hidden ??= new Set()
      for (const nodeId of collection.nodeIds) hidden.add(nodeId)
    }
    if (collection.locked === true) {
      locked ??= new Set()
      for (const nodeId of collection.nodeIds) locked.add(nodeId)
    }
  }

  // Reuse one empty index when nothing is hidden or locked — the common case —
  // so subscribers comparing by reference don't re-render on unrelated changes.
  if (!(hidden || locked)) return EMPTY_INDEX
  return { hidden: hidden ?? EMPTY_INDEX.hidden, locked: locked ?? EMPTY_INDEX.locked }
}

export function isHiddenByCollections(
  index: CollectionMembershipIndex,
  nodeId: AnyNodeId | string,
): boolean {
  return index.hidden.has(nodeId as AnyNodeId)
}

export function isLockedByCollections(
  index: CollectionMembershipIndex,
  nodeId: AnyNodeId | string,
): boolean {
  return index.locked.has(nodeId as AnyNodeId)
}

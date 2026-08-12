import { describe, expect, test } from 'bun:test'
import type { Collection, CollectionId } from '../schema/collections'
import type { AnyNodeId } from '../schema/types'
import {
  buildCollectionMembershipIndex,
  isHiddenByCollections,
  isLockedByCollections,
} from './collection-membership'

function collections(...list: Collection[]): Record<CollectionId, Collection> {
  return Object.fromEntries(list.map((c) => [c.id, c])) as Record<CollectionId, Collection>
}

function make(id: string, nodeIds: string[], extra: Partial<Collection> = {}): Collection {
  return {
    id: id as CollectionId,
    name: id,
    nodeIds: nodeIds as AnyNodeId[],
    ...extra,
  }
}

describe('buildCollectionMembershipIndex', () => {
  test('an absent flag reads as visible and unlocked, so old scenes load unchanged', () => {
    const index = buildCollectionMembershipIndex(collections(make('c1', ['wall_a'])))
    expect(isHiddenByCollections(index, 'wall_a')).toBe(false)
    expect(isLockedByCollections(index, 'wall_a')).toBe(false)
  })

  test('members of a hidden collection are hidden', () => {
    const index = buildCollectionMembershipIndex(
      collections(make('c1', ['wall_a', 'wall_b'], { visible: false })),
    )
    expect(isHiddenByCollections(index, 'wall_a')).toBe(true)
    expect(isHiddenByCollections(index, 'wall_b')).toBe(true)
    expect(isHiddenByCollections(index, 'wall_c')).toBe(false)
  })

  test('members of a locked collection are locked', () => {
    const index = buildCollectionMembershipIndex(
      collections(make('c1', ['wall_a'], { locked: true })),
    )
    expect(isLockedByCollections(index, 'wall_a')).toBe(true)
    expect(isHiddenByCollections(index, 'wall_a')).toBe(false)
  })

  test('hidden wins across overlapping membership', () => {
    // Unhiding one collection must not reveal what the other still hides.
    const index = buildCollectionMembershipIndex(
      collections(
        make('c1', ['wall_a'], { visible: false }),
        make('c2', ['wall_a'], { visible: true }),
      ),
    )
    expect(isHiddenByCollections(index, 'wall_a')).toBe(true)
  })

  test('locked wins across overlapping membership', () => {
    const index = buildCollectionMembershipIndex(
      collections(make('c1', ['wall_a'], { locked: true }), make('c2', ['wall_a'])),
    )
    expect(isLockedByCollections(index, 'wall_a')).toBe(true)
  })

  test('hidden and locked are independent', () => {
    const index = buildCollectionMembershipIndex(
      collections(make('c1', ['wall_a'], { visible: false, locked: true })),
    )
    expect(isHiddenByCollections(index, 'wall_a')).toBe(true)
    expect(isLockedByCollections(index, 'wall_a')).toBe(true)
  })

  test('the all-default case returns one shared index so subscribers do not churn', () => {
    const a = buildCollectionMembershipIndex(collections(make('c1', ['wall_a'])))
    const b = buildCollectionMembershipIndex(collections(make('c2', ['wall_b'])))
    expect(a).toBe(b)
  })

  test('an empty scene is handled', () => {
    const index = buildCollectionMembershipIndex({})
    expect(isHiddenByCollections(index, 'wall_a')).toBe(false)
  })
})

describe('index caching', () => {
  test('the same collections object yields the same index', () => {
    // Renderers call the builder from inside a store selector that re-runs on
    // every scene mutation; a fresh object each time would re-render every node.
    const input = collections(make('c1', ['wall_a'], { visible: false }))
    expect(buildCollectionMembershipIndex(input)).toBe(buildCollectionMembershipIndex(input))
  })

  test('a changed collections object yields a fresh index', () => {
    const before = collections(make('c1', ['wall_a'], { visible: false }))
    const after = collections(make('c1', ['wall_a'], { visible: true }))
    const beforeIndex = buildCollectionMembershipIndex(before)
    const afterIndex = buildCollectionMembershipIndex(after)
    expect(isHiddenByCollections(beforeIndex, 'wall_a')).toBe(true)
    expect(isHiddenByCollections(afterIndex, 'wall_a')).toBe(false)
  })
})

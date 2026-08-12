import { describe, expect, test } from 'bun:test'
import type { CollectionId } from './collections'
import { CeilingNode } from './nodes/ceiling'
import { ItemNode } from './nodes/item'
import { SlabNode } from './nodes/slab'
import { WallNode } from './nodes/wall'

// `createCollection` stamps `collectionIds` onto *any* node it adds, but the
// field used to be declared only on `item` — so every other kind had it stripped
// by the next `parse()`, losing the membership index on load. Zod strips unknown
// keys silently, so nothing failed loudly; the popover just showed no membership
// for a wall, slab, or ceiling.

const MEMBERSHIP = ['collection_abc' as CollectionId]
const SQUARE: [number, number][] = [
  [0, 0],
  [4, 0],
  [4, 4],
  [0, 4],
]

describe('collectionIds survives a schema round-trip', () => {
  test('wall', () => {
    const parsed = WallNode.parse({ start: [0, 0], end: [4, 0], collectionIds: MEMBERSHIP })
    expect(parsed.collectionIds).toEqual(MEMBERSHIP)
  })

  test('slab', () => {
    const parsed = SlabNode.parse({ polygon: SQUARE, collectionIds: MEMBERSHIP })
    expect(parsed.collectionIds).toEqual(MEMBERSHIP)
  })

  test('ceiling', () => {
    const parsed = CeilingNode.parse({ polygon: SQUARE, collectionIds: MEMBERSHIP })
    expect(parsed.collectionIds).toEqual(MEMBERSHIP)
  })

  test('item — the one kind that always worked, still does', () => {
    const parsed = ItemNode.parse({
      position: [0, 0, 0],
      asset: {
        id: 'asset_item',
        category: 'test',
        name: 'Test item',
        thumbnail: '/test.png',
        src: '/test.glb',
      },
      collectionIds: MEMBERSHIP,
    })
    expect(parsed.collectionIds).toEqual(MEMBERSHIP)
  })

  test('absent membership stays absent rather than becoming an empty array', () => {
    const parsed = WallNode.parse({ start: [0, 0], end: [4, 0] })
    expect(parsed.collectionIds).toBeUndefined()
  })
})

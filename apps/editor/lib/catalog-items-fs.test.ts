import { describe, expect, test } from 'bun:test'
import type { AssetInput } from '@pascal-app/core'
import { catalogEntryBlockHasCustomTag, findCatalogEntryRange } from './catalog-items-fs'
import { formatCatalogEntry } from './format-catalog-entry'

const SAMPLE = `export const CATALOG_ITEMS = [
  {
    id: 'builtin',
    category: 'furniture',
    name: 'Builtin',
    tags: ['floor'],
    thumbnail: '/a.png',
    src: '/items/builtin/model.glb',
    dimensions: [1, 1, 1],
  },
  {
    id: 'custom-chair',
    category: 'furniture',
    name: 'Chair',
    tags: ['floor', 'custom'],
    thumbnail: '/items/custom-chair/thumbnail.png',
    src: '/items/custom-chair/model.glb',
    dimensions: [0.5, 0.9, 0.5],
    surface: { height: 0.9 },
  },
]
`

describe('findCatalogEntryRange', () => {
  test('finds custom entry with nested surface object', () => {
    const range = findCatalogEntryRange(SAMPLE, 'custom-chair')
    expect(range).not.toBeNull()
    const block = SAMPLE.slice(range!.start, range!.end)
    expect(block).toContain("id: 'custom-chair'")
    expect(block).toContain('surface: { height: 0.9 }')
    expect(block.endsWith('  },')).toBe(true)
  })

  test('returns null for unknown id', () => {
    expect(findCatalogEntryRange(SAMPLE, 'missing')).toBeNull()
  })
})

describe('catalog entry update snippet', () => {
  test('replaces custom entry block in place', () => {
    const range = findCatalogEntryRange(SAMPLE, 'custom-chair')!
    const updatedEntry: AssetInput = {
      id: 'custom-chair',
      category: 'furniture',
      name: 'Chair Updated',
      tags: ['floor', 'custom'],
      thumbnail: '/items/custom-chair/thumbnail.png',
      src: '/items/custom-chair/model.glb',
      dimensions: [0.6, 1, 0.6],
      offset: [0, 0, 0],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
    }
    const snippet = formatCatalogEntry(updatedEntry)
    const updated = SAMPLE.slice(0, range.start) + snippet + SAMPLE.slice(range.end)
    expect(updated).toContain("name: 'Chair Updated'")
    expect(updated).toContain('dimensions: [0.6, 1, 0.6]')
    expect(updated).not.toContain("name: 'Chair',")
  })
})

describe('catalogEntryBlockHasCustomTag', () => {
  test('detects custom tag', () => {
    const range = findCatalogEntryRange(SAMPLE, 'custom-chair')!
    expect(catalogEntryBlockHasCustomTag(SAMPLE.slice(range.start, range.end))).toBe(true)
  })

  test('rejects builtin block', () => {
    const range = findCatalogEntryRange(SAMPLE, 'builtin')!
    expect(catalogEntryBlockHasCustomTag(SAMPLE.slice(range.start, range.end))).toBe(false)
  })
})

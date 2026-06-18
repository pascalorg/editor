import { describe, expect, test } from 'bun:test'
import { ItemNode } from '../schema'
import { CATALOG_ITEMS, findCatalogItem, searchCatalogItems } from './asset-catalog'

describe('shared asset catalog', () => {
  test('keeps catalog ids unique', () => {
    const ids = CATALOG_ITEMS.map((item) => item.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  test('exposes factory items to shared search', () => {
    expect(findCatalogItem('factory-extractor')?.name).toBe('Factory Extractor')
    expect(searchCatalogItems({ query: 'factory pipe' }).map((item) => item.id)).toContain(
      'factory-straight-pipe',
    )
  })

  test('category filters also match catalog tags for legacy MCP queries', () => {
    expect(searchCatalogItems({ query: 'bed', category: 'furniture' }).map((item) => item.id)).toContain(
      'double-bed',
    )
  })

  test('catalog item assets are accepted by item nodes', () => {
    const asset = findCatalogItem('factory-electric-box')
    expect(asset).toBeDefined()
    expect(() => ItemNode.parse({ asset })).not.toThrow()
  })
})

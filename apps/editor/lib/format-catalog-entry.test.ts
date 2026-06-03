import { describe, expect, test } from 'bun:test'
import { formatCatalogEntry } from './format-catalog-entry'

describe('formatCatalogEntry', () => {
  test('formats a minimal floor item', () => {
    const snippet = formatCatalogEntry({
      id: 'test-chair',
      category: 'furniture',
      name: 'Test Chair',
      tags: ['floor', 'chair'],
      thumbnail: '/items/test-chair/thumbnail.png',
      src: '/items/test-chair/model.glb',
      dimensions: [0.6, 0.9, 0.6],
      offset: [0, 0, 0],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
    })

    expect(snippet).toContain("id: 'test-chair'")
    expect(snippet).toContain("src: '/items/test-chair/model.glb'")
    expect(snippet).toMatch(/dimensions: \[0\.6, 0\.9, 0\.6\],/)
    expect(snippet).toMatch(/offset: \[0, 0, 0\],/)
    expect(snippet).toMatch(/rotation: \[0, 0, 0\],/)
    expect(snippet).toMatch(/scale: \[1, 1, 1\],/)
    expect(snippet).not.toContain('attachTo:')
    expect(snippet.endsWith('  },')).toBe(true)
  })
})

import { expect, test } from 'bun:test'
import { bedRecipe, ProceduralItemNode, shelfRecipe } from '@pascal-app/core/procedural-items'
import {
  acquireProceduralGeometry,
  buildProceduralGeometry,
  partAtFace,
  proceduralMetrics,
} from './geometry'

test('slot batching preserves pickable parts and dimensions', () => {
  for (const recipe of [shelfRecipe, bedRecipe]) {
    const node = ProceduralItemNode.parse({ recipe }),
      built = buildProceduralGeometry(node)
    expect(built.batches.length).toBe(recipe.slots.length)
    expect(built.triangles).toBeLessThan(100000)
    for (const batch of built.batches) {
      expect(partAtFace(batch.ranges, 0)).not.toBeNull()
      expect(batch.geometry.boundingBox!.isEmpty()).toBe(false)
      batch.geometry.dispose()
    }
  }
})
test('moves and paint share geometry; changed parameters rebuild; leases dispose at last release', () => {
  const node = ProceduralItemNode.parse({ recipe: shelfRecipe }),
    before = proceduralMetrics.builds
  const a = acquireProceduralGeometry(node),
    b = acquireProceduralGeometry({ ...node, position: [2, 0, 3], slots: { frame: '#123456' } })
  expect(a.value).toBe(b.value)
  expect(proceduralMetrics.builds - before).toBe(1)
  let disposals = 0
  for (const batch of a.value.batches) batch.geometry.addEventListener('dispose', () => disposals++)
  a.release()
  expect(disposals).toBe(0)
  b.release()
  expect(disposals).toBe(3)
  b.release()
  expect(disposals).toBe(3)
  const c = acquireProceduralGeometry({ ...node, parameters: { width: 2 } })
  expect(proceduralMetrics.builds - before).toBe(2)
  c.release()
  expect(proceduralMetrics.liveEntries).toBe(0)
})

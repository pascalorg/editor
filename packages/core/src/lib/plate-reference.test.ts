import { expect, test } from 'bun:test'
import { BlockNode, ItemNode, ShelfNode, SlabNode, StairNode, StairSegmentNode } from '../schema'
import { replacementPlateFor } from './plate-reference'

const slab = (id: string, x: number, z: number, elevation: number, parentId = 'level_test') =>
  SlabNode.parse({
    id,
    parentId,
    polygon: [
      [x, z],
      [x + 2, z],
      [x + 2, z + 2],
      [x, z + 2],
    ],
    elevation,
  })

test('a straddling item remaps by its rotated footprint even when its centre is off the upper plate', () => {
  const lower = slab('slab_lower', -1, -1, 0.05)
  const upper = slab('slab_upper', 1, -1, 0.55)
  const item = ItemNode.parse({
    position: [0.9, 0, 0],
    rotation: [0, Math.PI / 4, 0],
    asset: {
      id: 'test',
      name: 'Test',
      category: 'test',
      thumbnail: '',
      src: 'asset://test',
      dimensions: [1, 1, 1],
    },
  })
  item.parentId = 'level_test'
  expect(replacementPlateFor(item, 'supportSlabId', [lower, upper], {})).toBe(upper.id)
})

test('a retired stair deck remaps at the last flight arrival on the original destination level', () => {
  const old = slab('slab_old', -1, -1, 1.5, 'level_upper')
  const arrival = slab('slab_arrival', -1, 3.5, 1.5, 'level_upper')
  const nearStart = slab('slab_start', -1, -1, 1.5, 'level_upper')
  const stair = StairNode.parse({
    id: 'stair_test',
    parentId: 'level_lower',
    stairType: 'straight',
    deckSlabId: old.id,
  })
  const segment = StairSegmentNode.parse({ id: 'sseg_test', parentId: stair.id, length: 4 })
  stair.children = [segment.id]
  const nodes = { [stair.id]: stair, [segment.id]: segment, [old.id]: old }
  expect(replacementPlateFor(stair, 'deckSlabId', [nearStart, arrival], nodes)).toBe(arrival.id)
  expect(replacementPlateFor(stair, 'deckSlabId', [nearStart], nodes)).toBeUndefined()
})

test('parametric furniture and topology blocks remap by their bodies across a plate boundary', () => {
  const upper = slab('slab_upper', 1, -1, 0.55)
  const lower = slab('slab_lower', -1, -1, 0.05)
  const shelf = ShelfNode.parse({
    parentId: 'level_test',
    position: [0.9, 0, 0],
    width: 1,
    depth: 1,
  })
  const block = BlockNode.parse({ parentId: 'level_test', position: [0.9, 0, 0] })
  expect(replacementPlateFor(shelf, 'supportSlabId', [lower, upper], {})).toBe(upper.id)
  expect(replacementPlateFor(block, 'supportSlabId', [lower, upper], {})).toBe(upper.id)
})

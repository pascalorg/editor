import { expect, test } from 'bun:test'
import { SlabNode } from '../schema'
import { isSiteFlatwork } from './site-flatwork'

const polygon: Array<[number, number]> = [
  [0, 0],
  [4, 0],
  [4, 4],
  [0, 4],
]

test('a slab the site works marked flatwork is flatwork, whatever the kind', () => {
  for (const kind of ['lawn', 'driveway', 'walk', 'patio'])
    expect(isSiteFlatwork(SlabNode.parse({ polygon, metadata: { flatwork: kind } }))).toBe(true)
})

test('a floor slab, a terrace deck and a node with no metadata are not', () => {
  expect(isSiteFlatwork(SlabNode.parse({ polygon }))).toBe(false)
  expect(
    isSiteFlatwork(
      SlabNode.parse({
        polygon,
        metadata: { edgeElement: { id: 'collection_x', kind: 'porch', role: 'deck' } },
      }),
    ),
  ).toBe(false)
  expect(isSiteFlatwork({})).toBe(false)
  expect(isSiteFlatwork({ metadata: null })).toBe(false)
})

import { expect, test } from 'bun:test'
import { type AnyNode, FloorOpeningNode, WallNode } from '@pascal-app/core'
import { skirtingFloorOpeningRanges } from './skirting-floor-gaps'

const wall = WallNode.parse({
  id: 'wall_gallery',
  parentId: 'level_1',
  start: [0, 0],
  end: [6, 0],
  thickness: 0.2,
})

/** A void reaching the wall's left face (z = 0.1) from 1 m to 4 m along it. */
const opening = FloorOpeningNode.parse({
  id: 'floor-opening_void',
  parentId: 'level_1',
  polygon: [
    [1, 0.1],
    [4, 0.1],
    [4, 3],
    [1, 3],
  ],
})

const nodes = (...extra: AnyNode[]) =>
  Object.fromEntries([wall, opening, ...extra].map((node) => [node.id, node])) as Record<
    string,
    AnyNode
  >

test('a floor opening meeting a face breaks that face’s skirting over its span, not the other face’s', () => {
  const [range] = skirtingFloorOpeningRanges(wall, 'a', nodes())
  expect(range![0]).toBeCloseTo(1, 6)
  expect(range![1]).toBeCloseTo(4, 6)
  expect(skirtingFloorOpeningRanges(wall, 'b', nodes())).toEqual([])
})

test('an opening on another level, drawn on a ceiling, or clear of the face leaves the skirting whole', () => {
  const elsewhere = { ...opening, id: 'floor-opening_other', parentId: 'level_0' }
  const ceiling = { ...opening, id: 'floor-opening_ceiling', drawnOn: 'ceiling' as const }
  const clear = FloorOpeningNode.parse({
    id: 'floor-opening_clear',
    parentId: 'level_1',
    polygon: [
      [1, 0.5],
      [4, 0.5],
      [4, 3],
      [1, 3],
    ],
  })
  const only = (node: AnyNode) =>
    Object.fromEntries([wall, node].map((n) => [n.id, n])) as Record<string, AnyNode>
  for (const node of [elsewhere, ceiling, clear])
    expect(skirtingFloorOpeningRanges(wall, 'a', only(node as AnyNode))).toEqual([])
})

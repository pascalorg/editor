import { expect, test } from 'bun:test'
import { type AnyNode, LevelNode, WallNode } from '../schema'
import { shapeOfRect, wallsUnder } from './roof-bearing'

const RAIL = 3.5 * 0.0254
const corners: Array<[number, number]> = [
  [0, 0],
  [4, 0],
  [4, 3],
  [0, 3],
]

// A 4 x 3 m deck with a 36 in guard round it, the south side a wall in `walled`.
function deck(walled = false) {
  const level = LevelNode.parse({ id: 'level_deck', level: 0, height: 3 })
  const sides = corners.map((start, i) =>
    WallNode.parse({
      id: `wall_side${i}`,
      parentId: level.id,
      start,
      end: corners[(i + 1) % 4],
      ...(walled && i === 0
        ? { thickness: 0.2, height: 2.5 }
        : { wallType: 'railing', thickness: RAIL, height: 36 * 0.0254 }),
    }),
  )
  level.children = sides.map((wall) => wall.id)
  const nodes: Record<string, AnyNode> = Object.fromEntries(
    [level, ...sides].map((node) => [node.id, node]),
  )
  return { level, nodes }
}

test('a roof over a deck bears on none of its railings, on a wall along its edge it does', () => {
  const shape = shapeOfRect([0, 0, 4, 3], 'x', 'gable', 30)
  expect(wallsUnder(deck().nodes, 'level_deck', shape)).toEqual([])
  expect(wallsUnder(deck(true).nodes, 'level_deck', shape).map((wall) => wall.id)).toEqual([
    'wall_side0',
  ])
})

import { describe, expect, test } from 'bun:test'
import { BuildingNode, LevelNode, WallNode } from '../schema'
import { createRoof, grown } from './create-roof'
import type { SceneNodes } from './types'

type Pt = [number, number]

/** A storey whose walls close the polygon `corners`, in the order given. */
function storey(corners: Pt[]): SceneNodes {
  const walls = corners.map((start, index) =>
    WallNode.parse({
      id: `wall_${index}`,
      parentId: 'level_0',
      start,
      end: corners[(index + 1) % corners.length]!,
    }),
  )
  const level = LevelNode.parse({
    id: 'level_0',
    parentId: 'building_a',
    level: 0,
    height: 2.8,
    children: walls.map((wall) => wall.id),
  })
  const building = BuildingNode.parse({ id: 'building_a', children: [level.id] })
  return Object.fromEntries([building, level, ...walls].map((node) => [node.id, node]))
}

describe('create_roof: a roof outline that stays on the walls', () => {
  // A 30 m long, 0.52 m deep sliver ends in a 1° point; mitred, the point reached 11 m past the
  // wall and the roof segment came out 41.6 m long (0.2° made it 87 m).
  test('a sharp corner does not stretch the roof past the building', () => {
    const outcome = createRoof(
      storey([
        [0, 0],
        [30, 0],
        [0, 0.52],
      ]),
      {},
      { activeLevelId: null },
    )
    const segments = (outcome.changes?.create ?? [])
      .map(({ node }) => node)
      .filter((node) => node.type === 'roof-segment')

    expect(segments).toHaveLength(1)
    const { width, depth } = segments[0] as unknown as { width: number; depth: number }
    expect(Math.max(width, depth)).toBeLessThan(30.5)
    expect(Math.max(width, depth)).toBeGreaterThan(30)
  })
})

describe('the outline grown to the walls’ outer faces', () => {
  const finite = (points: Pt[]) => points.every((point) => point.every(Number.isFinite))

  test('mitres a right angle exactly', () => {
    const square: Pt[] = [
      [0, 0],
      [4, 0],
      [4, 4],
      [0, 4],
    ]
    const out = grown(square, 0.1)

    expect(out).toHaveLength(4)
    const expected: Pt[] = [
      [-0.1, -0.1],
      [4.1, -0.1],
      [4.1, 4.1],
      [-0.1, 4.1],
    ]
    for (const [i, [x, z]] of expected.entries()) {
      expect(out[i]![0]).toBeCloseTo(x, 9)
      expect(out[i]![1]).toBeCloseTo(z, 9)
    }
  })

  test('keeps a point of 0.2° within a wall’s width of its corner', () => {
    const sliver: Pt[] = [
      [0, 0],
      [30, 0],
      [0, 0.105],
    ]
    const out = grown(sliver, 0.1)

    expect(finite(out)).toBe(true)
    for (const [x, z] of out) {
      expect(x).toBeGreaterThan(-0.5)
      expect(x).toBeLessThan(30.5)
      expect(Math.abs(z)).toBeLessThan(0.5)
    }
  })

  test('gives finite points where an edge folds back exactly on itself', () => {
    const out = grown(
      [
        [0, 0],
        [10, 0],
        [5, 0],
      ],
      0.1,
    )

    expect(finite(out)).toBe(true)
  })
})

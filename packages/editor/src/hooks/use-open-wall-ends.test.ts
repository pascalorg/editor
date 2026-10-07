import { describe, expect, test } from 'bun:test'
import type { WallNode } from '@pascal-app/core'
import { analyseOpenWallEnds } from './use-open-wall-ends'

const wall = (id: string, start: [number, number], end: [number, number]) =>
  ({
    id,
    type: 'wall',
    object: 'node',
    parentId: 'level_a',
    visible: true,
    children: [],
    metadata: {},
    start,
    end,
    thickness: 0.1,
  }) as unknown as WallNode

// A 4 x 4 room whose last corner is left 4 cm open (bodies are 0.1 thick).
const walls = () => [
  wall('wall_1', [0, 0], [4, 0]),
  wall('wall_2', [4, 0], [4, 4]),
  wall('wall_3', [4, 4], [0, 4]),
  wall('wall_4', [0, 4], [0, 0.09]),
]

describe('open wall end analysis shared by the floor plan and 3D view', () => {
  test('finds the open corner', () => {
    const ends = analyseOpenWallEnds('level_a', walls())
    expect(ends.some((end) => end.wallId === 'wall_4' && end.end === 'end')).toBe(true)
  })

  test('two views reading the same walls get one result', () => {
    const shared = walls()
    const first = analyseOpenWallEnds('level_a', [...shared])
    expect(analyseOpenWallEnds('level_a', [...shared])).toBe(first)
  })

  test('a changed wall is analysed again', () => {
    const shared = walls()
    const first = analyseOpenWallEnds('level_a', shared)
    const closed = [...shared.slice(0, 3), wall('wall_4', [0, 4], [0, 0])]
    const next = analyseOpenWallEnds('level_a', closed)
    expect(next).not.toBe(first)
    expect(next.some((end) => end.wallId === 'wall_4')).toBe(false)
  })
})

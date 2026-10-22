import { describe, expect, test } from 'bun:test'
import { type AnyNode, LevelNode, WallNode } from '../../schema'
import { roomFaceCover } from './wall-room-sides'

function scene(...walls: [string, [number, number], [number, number], number?][]) {
  const level = LevelNode.parse({ id: 'level_cover' })
  const nodes = walls.map(([id, start, end, curveOffset]) =>
    WallNode.parse({ id, parentId: level.id, start, end, ...(curveOffset ? { curveOffset } : {}) }),
  )
  return Object.fromEntries([level, ...nodes].map((node) => [node.id, node])) as Record<
    string,
    AnyNode
  >
}

describe('roomFaceCover', () => {
  test('a room on all of one face and part of the other: whole, and part', () => {
    const nodes = scene(
      ['wall_long', [0, 0], [10, 0]],
      ['wall_ne', [10, 0], [10, 4]],
      ['wall_nn', [10, 4], [0, 4]],
      ['wall_nw', [0, 4], [0, 0]],
      ['wall_sw', [0, 0], [0, -3]],
      ['wall_ss', [0, -3], [6, -3]],
      ['wall_se', [6, -3], [6, 0]],
    )
    expect(roomFaceCover(nodes, 'wall_long')).toEqual({ a: 'whole', b: 'part' })
    expect(roomFaceCover(nodes, 'wall_nn')).toEqual({ a: 'whole', b: 'none' })
  })

  test('on a curve, an uncovered stretch is measured along the wall, not its chord', () => {
    // A half circle; a wall meets it 0.785 m along, only 0.06 m along its chord.
    const nodes = scene(
      ['wall_arc', [0, 0], [10, 0], 5],
      ['wall_base', [10, 0], [5, 0]],
      ['wall_spoke', [5, 0], [0.061558, -0.782172]],
    )
    const cover = roomFaceCover(nodes, 'wall_arc')
    expect(Object.values(cover).sort()).toEqual(['none', 'part'])
    // 15 cm of a wider half circle's end, under 0.2 mm of its chord.
    const wide = scene(
      ['wall_arc', [0, 0], [20, 0], 10],
      ['wall_base', [20, 0], [10, 0]],
      ['wall_spoke', [10, 0], [0.0011249789, -0.1499943751]],
    )
    expect(Object.values(roomFaceCover(wide, 'wall_arc')).sort()).toEqual(['none', 'part'])
  })
})

import { describe, expect, test } from 'bun:test'
import { WallNode, ZoneNode } from '../schema'
import { equivalentWidth, floorUnclaimedIssues, wallBodies } from './zone-coverage'

const square: [number, number][] = [
  [0, 0],
  [4, 0],
  [4, 4],
  [0, 4],
]
const zone = (polygon: [number, number][]) =>
  ZoneNode.parse({ id: 'zone_a', parentId: 'level_0', name: 'Hall', polygon, spaceRole: 'room' })
const ask = (zones: ZoneNode[]) =>
  floorUnclaimedIssues({
    levelId: 'level_0',
    levelName: 'Ground',
    spaces: [{ polygon: square, wallIds: [] }],
    zones,
    stairs: [],
    bodies: [],
  })

describe('the width of a piece is the short side of the rectangle with its area and perimeter', () => {
  test.each([
    ['a 16 cm x 1 m strip', 0.16, 1, 0.16],
    ['a 45 cm x 2.9 m strip', 0.45, 2.9, 0.45],
    ['a 3 m square', 3, 3, 3],
  ])('%s', (_, w, l, expected) => {
    expect(equivalentWidth(w * l, 2 * (w + l))).toBeCloseTo(expected, 6)
  })
})

describe('a boolean that fails is not a measurement', () => {
  test('a zone with a corner that is not a number leaves the level unmeasured, not the whole space unclaimed', () => {
    const broken = { ...zone(square), polygon: [[Number.NaN, 0], ...square.slice(1)] } as ZoneNode
    expect(
      ask([
        zone([
          [0, 0],
          [4, 0],
          [4, 4],
          [0, 4],
        ]),
        broken,
      ]),
    ).toEqual([])
  })

  test('the same space with a sound zone over half of it is measured', () => {
    expect(
      ask([
        zone([
          [0, 0],
          [4, 0],
          [4, 3],
          [0, 3],
        ]),
      ]),
    ).toHaveLength(1)
  })

  test('walls whose footprints cannot be read have no bodies to take out: the level is not measured', () => {
    const wall = {
      ...WallNode.parse({ id: 'wall_a', parentId: 'level_0', start: [0, 0], end: [4, 0] }),
      start: [Number.NaN, 0],
    }
    expect(wallBodies([wall as WallNode])).toBeNull()
    expect(wallBodies([])).toEqual([])
  })
})

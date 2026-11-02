import { describe, expect, test } from 'bun:test'
import { type AnyNode, BuildingNode, LevelNode, SiteNode, WallNode, ZoneNode } from '../schema'
import { roomCheckIssues } from './room-checks'
import type { SceneNodes } from './types'
import { wallInsideFaces } from './wall-outside-finish'

/**
 * The finish of an outside face shown on the inside face of the same wall. Walls here run so that
 * face a is on their left: the outer ring runs counter-clockwise, so a is in and b is out; the
 * partitions run north, so a looks west.
 */

const STUCCO = 'library:concrete-stucco'
const WHITE = 'library:preset-white'

type Room = { name: string; x0: number; x1: number }
type Wall = { id: string; start: [number, number]; end: [number, number]; slots?: object }

function scene(rooms: Room[], walls: Wall[]): SceneNodes {
  const zones = rooms.map(({ name, x0, x1 }, index) =>
    ZoneNode.parse({
      id: `zone_${index}`,
      parentId: 'level_0',
      name,
      polygon: [
        [x0, 0],
        [x1, 0],
        [x1, 4],
        [x0, 4],
      ],
      spaceRole: 'room',
      // The rooms list the walls the way the structure reconciler writes them; the spans are cut by geometry.
      boundaryWallIds: walls.map((wall) => wall.id),
    }),
  )
  const parsed = walls.map(({ id, start, end, slots }) =>
    WallNode.parse({ id, parentId: 'level_0', start, end, ...(slots ? { slots } : {}) }),
  )
  const nodes: AnyNode[] = [
    SiteNode.parse({ id: 'site_0', children: ['building_0'] }),
    BuildingNode.parse({ id: 'building_0', parentId: 'site_0', children: ['level_0'] }),
    LevelNode.parse({
      id: 'level_0',
      parentId: 'building_0',
      level: 0,
      children: [...parsed.map((wall) => wall.id), ...zones.map((zone) => zone.id)],
    }),
    ...parsed,
    ...zones,
  ]
  return Object.fromEntries(nodes.map((node) => [node.id, node])) as SceneNodes
}

const BOTH = { a: STUCCO, b: STUCCO }
/** A house of two bedrooms, 0..3 and 3..6, a partition between them and four outer walls. */
const house = (outer: object | undefined, mid: object | undefined, extra: Room[] = []) =>
  scene(
    [{ name: 'Bed 1', x0: 0, x1: 3 }, { name: 'Bed 2', x0: 3, x1: 6 }, ...extra],
    [
      { id: 'wall_s', start: [0, 0], end: [6, 0], slots: outer },
      { id: 'wall_e', start: [6, 0], end: [6, 4], slots: outer },
      { id: 'wall_n', start: [6, 4], end: [0, 4], slots: outer },
      { id: 'wall_w', start: [0, 4], end: [0, 0], slots: outer },
      { id: 'wall_mid', start: [3, 0], end: [3, 4], slots: mid },
    ],
  )
const found = (nodes: SceneNodes) =>
  roomCheckIssues(nodes).filter((issue) => issue.type === 'walls_outside_finish_inside')

describe('the outside finish on the inside of a wall', () => {
  test('both faces of the outer walls in one finish, the partition in another: one finding, the walls and rooms named', () => {
    const [issue, ...rest] = found(house(BOTH, { a: WHITE, b: WHITE }))
    expect(rest).toEqual([])
    expect(issue?.nodeIds.sort()).toEqual(['wall_e', 'wall_n', 'wall_s', 'wall_w'])
    expect(issue?.message).toContain('White Stucco')
    expect(issue?.message).toContain('shows on both faces of 4 walls (20.0 m)')
    expect(issue?.message).toContain('looks into Bed 1, Bed 2')
    expect(issue?.message).toContain('the partitions of the scene show White')
  })

  test('the finish on the outside face alone is the outside finish', () => {
    expect(found(house({ b: STUCCO }, { a: WHITE, b: WHITE }))).toEqual([])
  })

  test('the default on both faces writes nothing, so shows no finish twice', () => {
    expect(found(house(undefined, undefined))).toEqual([])
  })

  test('a finish a partition shows is the house’s inside finish', () => {
    expect(found(house(BOTH, BOTH))).toEqual([])
    // Plain white inside and out is the same: white is on the partitions.
    const white = { a: WHITE, b: WHITE }
    expect(found(house(white, white))).toEqual([])
  })

  test('with no partition there is nothing inside to tell it from', () => {
    const studio = scene(
      [{ name: 'Studio', x0: 0, x1: 6 }],
      [
        { id: 'wall_s', start: [0, 0], end: [6, 0], slots: BOTH },
        { id: 'wall_e', start: [6, 0], end: [6, 4], slots: BOTH },
        { id: 'wall_n', start: [6, 4], end: [0, 4], slots: BOTH },
        { id: 'wall_w', start: [0, 4], end: [0, 0], slots: BOTH },
      ],
    )
    expect(found(studio)).toEqual([])
  })

  test('a wall toward a porch or an alfresco is an outside wall', () => {
    const toPorch = scene(
      [
        { name: 'Bed 1', x0: 0, x1: 2 },
        { name: 'Bed 2', x0: 2, x1: 4 },
        { name: 'Porch', x0: 4, x1: 6 },
      ],
      [
        { id: 'wall_a', start: [2, 0], end: [2, 4], slots: { a: WHITE, b: WHITE } },
        { id: 'wall_b', start: [4, 0], end: [4, 4], slots: BOTH },
      ],
    )
    const [issue] = found(toPorch)
    expect(issue?.nodeIds).toEqual(['wall_b'])
    expect(issue?.message).toContain('looks into Bed 2')
    expect(issue?.message).not.toContain('Porch')
    expect(wallInsideFaces(toPorch, toPorch.wall_b as WallNode)).toEqual(['a'])
  })

  test('a partition has rooms on both faces, and a wall no room stands on has none to read', () => {
    expect(wallInsideFaces(house(BOTH, BOTH), house(BOTH, BOTH).wall_mid as WallNode)).toEqual([
      'a',
      'b',
    ])
    const lone = scene([], [{ id: 'wall_x', start: [0, 0], end: [4, 0], slots: BOTH }])
    expect(wallInsideFaces(lone, lone.wall_x as WallNode)).toBeNull()
  })
})

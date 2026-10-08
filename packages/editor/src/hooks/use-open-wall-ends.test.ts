import { describe, expect, test } from 'bun:test'
import { type AnyNode, DoorNode, type OpenWallEnd, WallNode } from '@pascal-app/core'
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

describe('the open-end preview reads what the walls host', () => {
  // An 88° near-miss T: the source wall stops 9 cm short of the long target wall.
  const level = 'level_t'
  const tWall = (id: string, start: [number, number], end: [number, number], thickness = 0.1) =>
    WallNode.parse({ id, parentId: level, start, end, thickness })
  const scene = () => {
    const tip: [number, number] = [2 + (3 - 0.09) / Math.tan((88 * Math.PI) / 180), 0.09]
    const source = tWall('wall_source', [2, 3], tip, 0.01)
    return {
      source,
      walls: [
        source,
        tWall('wall_target', [-20, 0], [30, 0], 0.01),
        tWall('wall_anchor', [2, 3], [-20, 3]),
        tWall('wall_left', [-20, 3], [-20, 0]),
      ],
    }
  }
  const sourceEnd = (ends: OpenWallEnd[]) =>
    ends.find((end) => end.wallId === 'wall_source' && end.end === 'end')

  test('without an opening the preview squares the corner', () => {
    const point = sourceEnd(analyseOpenWallEnds(level, scene().walls))?.candidate?.point
    expect(point?.[0]).toBeCloseTo(2, 6)
    expect(point?.[1]).toBeCloseTo(0, 6)
  })

  test('a door flush with the anchored end keeps the join straight, and only the door changing re-runs it', () => {
    const { source, walls } = scene()
    const door = DoorNode.parse({
      id: 'door_source',
      parentId: source.id,
      wallId: source.id,
      position: [0.4, 1.05, 0],
      width: 0.8,
    })
    const hosted: AnyNode[] = [
      { ...source, children: [door.id] } as AnyNode,
      ...walls.slice(1),
      door as AnyNode,
    ]
    const first = analyseOpenWallEnds(level, hosted)
    const point = sourceEnd(first)?.candidate?.point
    expect(point?.[0]).toBeCloseTo(2 + 3 / Math.tan((88 * Math.PI) / 180), 6)
    expect(point?.[1]).toBeCloseTo(0, 6)

    const narrower = { ...door, width: 0.6 } as AnyNode
    const next = analyseOpenWallEnds(level, [...hosted.slice(0, -1), narrower])
    expect(next).not.toBe(first)
  })
})

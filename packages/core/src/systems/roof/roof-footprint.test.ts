import { describe, expect, test } from 'bun:test'
import { type AnyNode, LevelNode, SeparatorNode, WallNode, ZoneNode } from '../../schema'
import {
  outdoorRoomRoofOutline,
  resolveRoomRoofFootprint,
  resolveRoomRoofFootprintOnLevel,
} from './roof-footprint'

const RAIL = 3.5 * 0.0254
type P = [number, number]

const near = (value: readonly (readonly number[])[], expected: P[]) => {
  expect(value).toHaveLength(expected.length)
  value.forEach((point, i) => {
    expect(point[0]).toBeCloseTo(expected[i]![0], 6)
    expect(point[1]).toBeCloseTo(expected[i]![1], 6)
  })
}

// A 10 x 8 m house of 0.2 m walls, a porch 6 m along its south wall (z 0), 2.5 m deep.
function porch(open: 'separators' | 'railings' = 'separators') {
  const level = LevelNode.parse({ id: 'level_ground', level: 0, height: 3 })
  const corners: P[] = [
    [0, 0],
    [10, 0],
    [10, 8],
    [0, 8],
  ]
  const house = corners.map((start, i) =>
    WallNode.parse({
      id: `wall_house${i}`,
      parentId: level.id,
      start,
      end: corners[(i + 1) % 4],
      thickness: 0.2,
    }),
  )
  const sides: Array<[P, P]> = [
    [
      [2, 0],
      [2, -2.5],
    ],
    [
      [2, -2.5],
      [8, -2.5],
    ],
    [
      [8, -2.5],
      [8, 0],
    ],
  ]
  const edges = sides.map(([start, end], i) =>
    open === 'separators'
      ? SeparatorNode.parse({ id: `separator_p${i}`, parentId: level.id, start, end })
      : WallNode.parse({
          id: `wall_rail${i}`,
          parentId: level.id,
          start,
          end,
          wallType: 'railing',
          thickness: RAIL,
          height: 36 * 0.0254,
        }),
  )
  const zone = ZoneNode.parse({
    parentId: level.id,
    name: open === 'separators' ? 'Porch' : 'Deck',
    roomType: open === 'separators' ? 'porch' : 'deck',
    polygon: [
      [2, 0],
      [2, -2.5],
      [8, -2.5],
      [8, 0],
    ],
  })
  level.children = [...house, ...edges, zone].map((node) => node.id) as LevelNode['children']
  const nodes: Record<string, AnyNode> = Object.fromEntries(
    [level, ...house, ...edges, zone].map((node) => [node.id, node]),
  )
  return { level, house, edges, zone, nodes }
}

describe('a porch, deck or patio roof outline', () => {
  test('a porch keeps its invisible walls as its edge, the house wall on its centre line', () => {
    const { house, edges, zone } = porch()
    const outline = outdoorRoomRoofOutline(zone, house, edges as SeparatorNode[])
    near(outline.polygon, zone.polygon)
    expect(outline.edges.map((edge) => edge?.kind)).toEqual([
      'separator',
      'separator',
      'separator',
      'wall',
    ])
    expect(outline.edges[3]?.id).toBe('wall_house0')
  })

  test("a deck's railings move out to their outside faces, meeting at the posts' corners", () => {
    const { house, edges, zone } = porch('railings')
    const outline = outdoorRoomRoofOutline(zone, [...house, ...(edges as WallNode[])], [])
    const h = RAIL / 2
    near(outline.polygon, [
      [2 - h, 0],
      [2 - h, -2.5 - h],
      [8 + h, -2.5 - h],
      [8 + h, 0],
    ])
    expect(outline.edges.map((edge) => edge?.kind)).toEqual([
      'railing',
      'railing',
      'railing',
      'wall',
    ])
  })

  test('a railing running on into an invisible wall along one line steps out at the join', () => {
    const { house, zone } = porch()
    const level = zone.parentId!
    const rail = WallNode.parse({
      parentId: level,
      start: [5, -2.5],
      end: [2, -2.5],
      wallType: 'railing',
      thickness: RAIL,
    })
    const separators = [
      SeparatorNode.parse({ parentId: level, start: [2, 0], end: [2, -2.5] }),
      SeparatorNode.parse({ parentId: level, start: [8, -2.5], end: [5, -2.5] }),
      SeparatorNode.parse({ parentId: level, start: [8, 0], end: [8, -2.5] }),
    ]
    const room = {
      polygon: [
        [2, 0],
        [8, 0],
        [8, -2.5],
        [5, -2.5],
        [2, -2.5],
      ] as P[],
    }
    const outline = outdoorRoomRoofOutline(room, [...house, rail], separators)
    const h = RAIL / 2
    near(outline.polygon, [
      [2, 0],
      [8, 0],
      [8, -2.5],
      [5, -2.5],
      [5, -2.5 - h],
      [2, -2.5 - h],
    ])
    expect(outline.edges.map((edge) => edge?.kind ?? null)).toEqual([
      'wall',
      'separator',
      'separator',
      null,
      'railing',
      'separator',
    ])
  })
})

describe('the Room pick over a porch, deck or patio', () => {
  test('roofs a porch to its invisible walls, standing on the house wall it leans on', () => {
    const { level, nodes } = porch()
    const target = resolveRoomRoofFootprint(level.id, nodes, [5, -1])!
    expect(target).toMatchObject({ rectangular: true, levelId: level.id })
    expect(target.width * target.depth).toBeCloseTo(6 * 2.5, 6)
    expect(Math.max(target.width, target.depth)).toBeCloseTo(6, 6)
    near([target.center], [[5, -1.25]])
    expect(target.wallIds).toEqual(['wall_house0'])
    expect([...(target.edgeIds ?? [])].sort()).toEqual([
      'separator_p0',
      'separator_p1',
      'separator_p2',
    ])
  })

  test("roofs a deck to its railings' outside faces, its railings no walls it stands on", () => {
    const { level, nodes } = porch('railings')
    const target = resolveRoomRoofFootprint(level.id, nodes, [5, -1])!
    const h = RAIL / 2
    expect(Math.max(target.width, target.depth)).toBeCloseTo(6 + 2 * h, 6)
    expect(Math.min(target.width, target.depth)).toBeCloseTo(2.5 + h, 6)
    near([target.center], [[5, -(2.5 + h) / 2]])
    expect(target.wallIds).toEqual(['wall_house0'])
    expect([...(target.edgeIds ?? [])].sort()).toEqual(['wall_rail0', 'wall_rail1', 'wall_rail2'])
  })

  test('finds the porch on the storey below from the roof level', () => {
    const { level, nodes } = porch()
    const roofLevel = LevelNode.parse({ id: 'level_roof', level: 1, height: 3 })
    const target = resolveRoomRoofFootprint(
      roofLevel.id,
      { ...nodes, [roofLevel.id]: roofLevel },
      [5, -1],
    )
    expect(target?.levelId).toBe(level.id)
    expect(target?.wallIds).toEqual(['wall_house0'])
  })

  test("an invisible wall inside the house never shrinks the house's roof to one side of it", () => {
    const { level, nodes } = porch()
    const divider = SeparatorNode.parse({ parentId: level.id, start: [5, 0], end: [5, 8] })
    const kitchen = ZoneNode.parse({
      parentId: level.id,
      name: 'Kitchen',
      polygon: [
        [0, 0],
        [5, 0],
        [5, 8],
        [0, 8],
      ],
    })
    const scene = {
      ...nodes,
      [divider.id]: divider,
      [kitchen.id]: kitchen,
      [level.id]: { ...level, children: [...level.children, divider.id, kitchen.id] },
    } as Record<string, AnyNode>
    const target = resolveRoomRoofFootprint(level.id, scene, [2, 4])!
    expect(target.width * target.depth).toBeCloseTo(10 * 8, 6)
    expect(target.wallIds).toHaveLength(4)
    expect(target.edgeIds).toBeUndefined()
  })

  test("the storey's own room test still reads walls alone, so a porch on posts stays put", () => {
    const { level, nodes } = porch()
    // `standsOverStorey` asks this: a porch closed by invisible walls is no room of the walls.
    expect(resolveRoomRoofFootprintOnLevel(level.id, nodes, [5, -1])).toBeNull()
    expect(resolveRoomRoofFootprintOnLevel(level.id, nodes, [5, 4])?.wallIds).toHaveLength(4)
  })
})

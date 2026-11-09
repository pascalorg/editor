import { describe, expect, test } from 'bun:test'
import {
  type AnyNode,
  type AnyNodeId,
  BuildingNode,
  LevelNode,
  RoofNode,
  RoofSegmentNode,
  SeparatorNode,
  WallNode,
} from '@pascal-app/core'
import {
  bearingWallThickness,
  catchRoofOnWalls,
  catchRoofSideOnWalls,
  placeRoofOnWalls,
  type RoofCatchLine,
  type RoofWallLine,
  roofCatchWalls,
  segmentWallLine,
  settleRoofOnEdges,
  settleSegmentOnEdges,
} from './wall-catch'

const room: [number, number][] = [
  [0, 0],
  [10, 0],
  [10, 8],
  [0, 8],
]
const roomWalls = room.map((start, i) =>
  WallNode.parse({ id: `wall_${i}`, parentId: 'level_g', start, end: room[(i + 1) % 4] }),
)

const near = (value: readonly number[], expected: number[]) => {
  for (const [i, v] of value.entries()) expect(v).toBeCloseTo(expected[i]!, 6)
}

describe('a roof catching on the walls under it', () => {
  test('wall lines a little off the walls lay onto their centre lines', () => {
    const line: RoofWallLine = { center: [5.15, 4.1], angle: 0, hw: 5, hd: 4 }
    const caught = catchRoofOnWalls({ lines: [line], walls: roomWalls, angle: 0 })
    expect(caught).toMatchObject({ u: true, v: true })
    near(caught.shift, [-0.15, -0.1])
  })

  test('a segment turned a quarter catches the same walls on its own axes', () => {
    const line: RoofWallLine = { center: [5.15, 4.1], angle: -Math.PI / 2, hw: 4, hd: 5 }
    const caught = catchRoofOnWalls({ lines: [line], walls: roomWalls, angle: -Math.PI / 2 })
    expect(caught).toMatchObject({ u: true, v: true })
    near(caught.shift, [-0.15, -0.1])
  })

  test('too far off, or past the end of a wall, it does not catch', () => {
    const far: RoofWallLine = { center: [5.4, 4], angle: 0, hw: 5, hd: 4 }
    expect(catchRoofOnWalls({ lines: [far], walls: roomWalls, angle: 0 })).toMatchObject({
      u: false,
      v: true,
    })
    const beyond = WallNode.parse({ parentId: 'level_g', start: [20, 0.1], end: [30, 0.1] })
    const line: RoofWallLine = { center: [5, 4], angle: 0, hw: 5, hd: 4 }
    expect(catchRoofOnWalls({ lines: [line], walls: [beyond], angle: 0 })).toMatchObject({
      u: false,
      v: false,
    })
  })

  test('a wall drawn by its face catches on its body centre, half its thickness in', () => {
    // Drawn along its outer face at z 0, a 0.2 m wall's body centre runs at z 0.1.
    const faced = WallNode.parse({
      parentId: 'level_g',
      start: [0, 0],
      end: [10, 0],
      thickness: 0.2,
      justification: 'a',
    })
    const line: RoofWallLine = { center: [5, 4.05], angle: 0, hw: 5, hd: 4 }
    const caught = catchRoofOnWalls({ lines: [line], walls: [faced], angle: 0 })
    expect(caught).toMatchObject({ u: false, v: true })
    near(caught.shift, [0, 0.05])
  })

  test('a caught axis beats the grid, the other keeps the grid', () => {
    const placed = placeRoofOnWalls(
      [5.12, 4.3],
      [5.5, 4.5],
      { shift: [-0.12, 0], u: true, v: false },
      0,
    )
    near(placed, [5, 4.5])
  })

  test('a side pulled near a wall sizes the segment onto its centre line, the other side held', () => {
    // Wall line x 1..9 by z 1..7: the +x side pulled to 9.85, the -x side to 0.2.
    const line: RoofWallLine = { center: [5, 4], angle: 0, hw: 4, hd: 3 }
    expect(
      catchRoofSideOnWalls({ line, axis: 'x', side: 1, value: 8.85, walls: roomWalls }),
    ).toBeCloseTo(9, 6)
    expect(
      catchRoofSideOnWalls({ line, axis: 'x', side: -1, value: 8.8, walls: roomWalls }),
    ).toBeCloseTo(9, 6)
    expect(
      catchRoofSideOnWalls({ line, axis: 'z', side: 1, value: 6.9, walls: roomWalls }),
    ).toBeCloseTo(7, 6)
    expect(
      catchRoofSideOnWalls({ line, axis: 'x', side: 1, value: 8.5, walls: roomWalls }),
    ).toBeNull()
  })

  test('a quarter-turned segment pulls its own x side onto the wall across it', () => {
    // Its x axis runs along plan -z, so its +x side faces the wall at z 0.
    const line: RoofWallLine = { center: [5, 4], angle: -Math.PI / 2, hw: 3, hd: 4 }
    expect(
      catchRoofSideOnWalls({ line, axis: 'x', side: 1, value: 6.9, walls: roomWalls }),
    ).toBeCloseTo(7, 6)
  })

  test('a wall line on the walls takes the thickest of the walls it stands on', () => {
    const thick = (thickness: number, i: number) => WallNode.parse({ ...roomWalls[i], thickness })
    const walls = [thick(0.18, 0), thick(0.18, 1), thick(0.24, 2), thick(0.18, 3)]
    const on: RoofWallLine = { center: [5.1, 4], angle: 0, hw: 5, hd: 4 }
    expect(bearingWallThickness(on, walls)).toBeCloseTo(0.24, 6)
    // Only its -z edge on the wall at z 0: that wall's thickness.
    const half: RoofWallLine = { center: [5, 2], angle: 0, hw: 3, hd: 2 }
    expect(bearingWallThickness(half, walls)).toBeCloseTo(0.18, 6)
    const off: RoofWallLine = { center: [5, 4], angle: 0, hw: 3, hd: 2 }
    expect(bearingWallThickness(off, walls)).toBeNull()
  })

  test("a segment's wall line goes through its roof's place and turn", () => {
    const line = segmentWallLine(
      { position: [2, 0, 3], rotation: Math.PI / 2 },
      { position: [1, 0, 0], rotation: 0, width: 6, depth: 4 },
    )
    near(line.center, [2, 2])
    expect(line.angle).toBeCloseTo(-Math.PI / 2, 6)
    expect([line.hw, line.hd]).toEqual([3, 2])
  })

  test("the walls are the roof level's and the storey's below, never curved ones", () => {
    const curved = WallNode.parse({
      parentId: 'level_g',
      start: [0, 0],
      end: [0, -4],
      curveOffset: 1,
    })
    const upstairs = WallNode.parse({ parentId: 'level_roof', start: [2, 2], end: [6, 2] })
    const ground = LevelNode.parse({
      id: 'level_g',
      parentId: 'building_h',
      level: 0,
      children: [...roomWalls.map((wall) => wall.id), curved.id],
    })
    const roofLevel = LevelNode.parse({
      id: 'level_roof',
      parentId: 'building_h',
      level: 1,
      children: [upstairs.id, 'roof_r'],
    })
    const segment = RoofSegmentNode.parse({ id: 'rseg_r', parentId: 'roof_r' })
    const roof = RoofNode.parse({ id: 'roof_r', parentId: roofLevel.id, children: [segment.id] })
    const building = BuildingNode.parse({ id: 'building_h', children: [ground.id, roofLevel.id] })
    const nodes = Object.fromEntries(
      [building, ground, roofLevel, roof, segment, curved, upstairs, ...roomWalls].map((node) => [
        node.id,
        node as AnyNode,
      ]),
    ) as Record<AnyNodeId, AnyNode>
    const ids = roofCatchWalls(nodes, roofLevel.id).map((wall) => wall.id)
    expect(ids.sort()).toEqual([upstairs.id, ...roomWalls.map((wall) => wall.id)].sort())
  })
})

// A porch 6 m along a 0.2 m house wall at z 0, 2.5 m deep, closed by invisible walls or fenced by
// railings: its edges at x 2 and 8 and z -2.5.
const RAIL = 3.5 * 0.0254
const H = RAIL / 2
const houseWall = WallNode.parse({
  id: 'wall_house',
  parentId: 'level_g',
  start: [0, 0],
  end: [10, 0],
  thickness: 0.2,
})
const porchSides: [[number, number], [number, number]][] = [
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
function porchLines(open: 'separators' | 'railings'): RoofCatchLine[] {
  const ground = LevelNode.parse({ id: 'level_g', level: 0 })
  const sides = porchSides.map(([start, end], i) =>
    open === 'separators'
      ? SeparatorNode.parse({ id: `separator_${i}`, parentId: ground.id, start, end })
      : WallNode.parse({
          id: `wall_rail${i}`,
          parentId: ground.id,
          start,
          end,
          wallType: 'railing',
          thickness: RAIL,
        }),
  )
  ground.children = [houseWall.id, ...sides.map((side) => side.id)] as LevelNode['children']
  const nodes = Object.fromEntries(
    [ground, houseWall, ...sides].map((node) => [node.id, node as AnyNode]),
  ) as Record<AnyNodeId, AnyNode>
  return roofCatchWalls(nodes, ground.id)
}

describe("a roof catching on a porch's invisible walls and a deck's railings", () => {
  test('invisible walls and railings are edges, the house wall a wall it stands on', () => {
    const porch = porchLines('separators')
    expect(porch.map((line) => line.type).sort()).toEqual([
      'roof-edge',
      'roof-edge',
      'roof-edge',
      'wall',
    ])
    const deck = porchLines('railings').filter((line) => line.type === 'roof-edge')
    expect(deck.map((line) => line.type === 'roof-edge' && line.thickness)).toEqual([
      RAIL,
      RAIL,
      RAIL,
    ])
  })

  test("drawn out to a porch's invisible walls, its walls' outer faces stand on them", () => {
    // Drawn from the house wall's centre line out to the porch's corners, with walls 0.2 m thick.
    const drawn: RoofWallLine = { center: [5, -1.25], angle: 0, hw: 3, hd: 1.25 }
    const settled = settleRoofOnEdges(drawn, porchLines('separators'), 0.2)
    near(settled.center, [5, -1.2])
    near([settled.hw, settled.hd], [2.9, 1.2])
  })

  test("drawn out to a deck's railings, its outer faces stand on the railings' outside faces", () => {
    const drawn: RoofWallLine = {
      center: [5, -(2.5 + H) / 2],
      angle: 0,
      hw: 3 + H,
      hd: (2.5 + H) / 2,
    }
    const settled = settleRoofOnEdges(drawn, porchLines('railings'), 0.2)
    near(settled.center, [5, -(2.4 + H) / 2])
    near([settled.hw, settled.hd], [2.9 + H, (2.4 + H) / 2])
    // Drawn on the grid, on the railings' centre lines, it takes their outside faces all the same.
    const gridded: RoofWallLine = { center: [5, -1.25], angle: 0, hw: 3, hd: 1.25 }
    const onGrid = settleRoofOnEdges(gridded, porchLines('railings'), 0.2)
    near(onGrid.center, [5, -(2.4 + H) / 2])
    near([onGrid.hw, onGrid.hd], [2.9 + H, (2.4 + H) / 2])
  })

  test('a segment settles in its roof, a quarter-turned one on its own axes', () => {
    const roof = { position: [5, 0, -1.25] as [number, number, number], rotation: 0 }
    const lines = porchLines('separators')
    const flat = { position: [0, 0, 0] as [number, number, number], rotation: 0 }
    const settled = settleSegmentOnEdges(
      roof,
      { ...flat, width: 6, depth: 2.5, wallThickness: 0.2 },
      lines,
    )
    near(settled.position, [0, 0, 0.05])
    near([settled.width, settled.depth], [5.8, 2.4])
    const turned = settleSegmentOnEdges(
      roof,
      { ...flat, rotation: Math.PI / 2, width: 2.5, depth: 6, wallThickness: 0.2 },
      lines,
    )
    near(turned.position, [0, 0, 0.05])
    near([turned.width, turned.depth], [2.4, 5.8])
  })

  test('moved a little off, it catches with its outer faces on the edges', () => {
    // On the house wall's centre line at z 0, its outer faces on x 2 and 8 and z -2.5.
    const off: RoofWallLine = { center: [5.1, -1.15], angle: 0, hw: 2.9, hd: 1.2 }
    const porch = catchRoofOnWalls({ lines: [off], walls: porchLines('separators'), angle: 0 })
    expect(porch).toMatchObject({ u: true, v: true })
    near(porch.shift, [-0.1, -0.05])
    // A deck: the outer faces on the railings' outside faces, x 2 - H and 8 + H and z -2.5 - H.
    const deckOff: RoofWallLine = {
      center: [5.08, -(2.4 + H) / 2 - 0.04],
      angle: 0,
      hw: 2.9 + H,
      hd: (2.4 + H) / 2,
    }
    const deck = catchRoofOnWalls({ lines: [deckOff], walls: porchLines('railings'), angle: 0 })
    expect(deck).toMatchObject({ u: true, v: true })
    near(deck.shift, [-0.08, 0.04])
  })

  test("a side arrow pulled near an invisible wall stops with the roof's outer face on it", () => {
    const line: RoofWallLine = {
      center: [5, -1.2],
      angle: 0,
      hw: 2.9,
      hd: 1.2,
      wallThickness: 0.2,
    }
    const walls = porchLines('separators')
    expect(catchRoofSideOnWalls({ line, axis: 'x', side: 1, value: 5.7, walls })).toBeCloseTo(
      5.8,
      6,
    )
    expect(catchRoofSideOnWalls({ line, axis: 'z', side: -1, value: 2.3, walls })).toBeCloseTo(
      2.4,
      6,
    )
  })

  test('with no wall under it, a roof keeps its own walls, their outer faces on the edges', () => {
    const lines = porchLines('separators').filter((line) => line.type === 'roof-edge')
    const free: RoofWallLine = {
      center: [5.1, -1.3],
      angle: 0,
      hw: 2.95,
      hd: 1.2,
      wallThickness: 0.1,
    }
    expect(bearingWallThickness(free, lines)).toBeNull()
    // Its 0.1 m walls' outer faces on x 2 and 8 and z -2.5: its line 0.05 m in from them.
    const caught = catchRoofOnWalls({ lines: [free], walls: lines, angle: 0 })
    expect(caught).toMatchObject({ u: true, v: true })
    near(caught.shift, [-0.1, 0.05])
  })

  test('neither an invisible wall nor a railing gives the roof its wall thickness', () => {
    const along: RoofWallLine = { center: [5, -1.25], angle: 0, hw: 3, hd: 1.25 }
    expect(bearingWallThickness(along, porchLines('separators'))).toBeCloseTo(0.2, 6)
    expect(
      bearingWallThickness(
        along,
        porchLines('railings').filter((line) => line.type === 'roof-edge'),
      ),
    ).toBeNull()
  })
})

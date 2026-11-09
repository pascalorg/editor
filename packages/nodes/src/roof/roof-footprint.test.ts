import { describe, expect, test } from 'bun:test'
import {
  emitter,
  fitRoofFootprint,
  LevelNode,
  resolveRoomRoofFootprint,
  SeparatorNode,
  type WallEvent,
  WallNode,
  ZoneNode,
} from '@pascal-app/core'
import {
  isStandardRoofWallEligible,
  parseRoofFootprintSource,
  resolveRoofFootprintElevation,
  resolveRoofFootprintWorldElevation,
  resolveRoofWallTopWorldElevation,
  roofEdgeAnchors,
  roofFootprintPreviewIds,
  roofSnapEdges,
  subscribeToConicalRoofWallClicks,
} from './roof-footprint'

describe('roof footprint sources', () => {
  test('normalizes footprint sources for the selected roof type', () => {
    expect(parseRoofFootprintSource('room', 'conical')).toBe('walls')
    expect(parseRoofFootprintSource('draw', 'conical')).toBe('walls')
    expect(parseRoofFootprintSource('walls', 'hip')).toBe('draw')
    expect(parseRoofFootprintSource(undefined, 'hip')).toBe('draw')
    expect(parseRoofFootprintSource('draw', 'hip')).toBe('draw')
    expect(parseRoofFootprintSource('room', 'hip')).toBe('room')
  })

  test('fits a rotated rectangular room', () => {
    const target = fitRoofFootprint(
      'room-1',
      [
        [0, 0],
        [4, 4],
        [2, 6],
        [-2, 2],
      ],
      [],
    )

    expect(target?.rectangular).toBe(true)
    expect(target?.width).toBeCloseTo(Math.sqrt(32))
    expect(target?.depth).toBeCloseTo(Math.sqrt(8))
    expect(target?.center[0]).toBeCloseTo(1)
    expect(target?.center[1]).toBeCloseTo(3)
    expect(target?.rotation).toBeCloseTo(-Math.PI / 4)
  })

  test('marks curved and irregular rooms as non-rectangular', () => {
    const target = fitRoofFootprint(
      'room-2',
      [
        [0, 0],
        [4, 0],
        [4, 2],
        [2, 1],
        [0, 2],
      ],
      [],
    )
    expect(target?.rectangular).toBe(false)
  })

  test('only treats axis-aligned straight walls as standard-roof draw guides', () => {
    expect(isStandardRoofWallEligible(WallNode.parse({ start: [0, 0], end: [4, 0] }))).toBe(true)
    expect(isStandardRoofWallEligible(WallNode.parse({ start: [0, 0], end: [0, 4] }))).toBe(true)
    expect(isStandardRoofWallEligible(WallNode.parse({ start: [0, 0], end: [4, 3] }))).toBe(false)
    expect(
      isStandardRoofWallEligible(WallNode.parse({ start: [-2, 0], end: [2, 0], curveOffset: 2 })),
    ).toBe(false)
  })

  test('keeps an L-shaped room available as straight-wall draw guides but not a room footprint', () => {
    const target = fitRoofFootprint(
      'room-l-shape',
      [
        [0, 0],
        [4, 0],
        [4, 2],
        [2, 2],
        [2, 4],
        [0, 4],
      ],
      [],
    )

    expect(target?.rectangular).toBe(false)
  })

  test('rejects curved and irregular rooms for rectangular-only roof footprints', () => {
    const walls = [
      WallNode.parse({ start: [0, 0], end: [4, 0] }),
      WallNode.parse({ start: [4, 0], end: [4, 2] }),
      WallNode.parse({ start: [4, 2], end: [2, 3] }),
      WallNode.parse({ start: [2, 3], end: [0, 2] }),
      WallNode.parse({ start: [0, 2], end: [0, 0] }),
    ]
    const level = LevelNode.parse({ children: walls.map((wall) => wall.id) })
    const nodes = Object.fromEntries([level, ...walls].map((node) => [node.id, node]))

    expect(resolveRoomRoofFootprint(level.id, nodes, [2, 1], { rectangularOnly: true })).toBeNull()
  })

  test('resolves the enclosed room beneath the pointer', () => {
    const walls = [
      WallNode.parse({ start: [0, 0], end: [4, 0] }),
      WallNode.parse({ start: [4, 0], end: [4, 3] }),
      WallNode.parse({ start: [4, 3], end: [0, 3] }),
      WallNode.parse({ start: [0, 3], end: [0, 0] }),
    ]
    const level = LevelNode.parse({ children: walls.map((wall) => wall.id) })
    const nodes = Object.fromEntries([level, ...walls].map((node) => [node.id, node]))

    const target = resolveRoomRoofFootprint(level.id, nodes, [2, 1])

    expect(target?.rectangular).toBe(true)
    expect(target?.wallIds).toHaveLength(4)
    expect(resolveRoomRoofFootprint(level.id, nodes, [8, 8])).toBeNull()
  })

  test('resolves a room on the level below the active roof level', () => {
    const walls = [
      WallNode.parse({ start: [0, 0], end: [4, 0] }),
      WallNode.parse({ start: [4, 0], end: [4, 3] }),
      WallNode.parse({ start: [4, 3], end: [0, 3] }),
      WallNode.parse({ start: [0, 3], end: [0, 0] }),
    ]
    const groundLevel = LevelNode.parse({
      children: walls.map((wall) => wall.id),
      level: 0,
    })
    const activeLevel = LevelNode.parse({ children: [], level: 1 })
    const nodes = Object.fromEntries(
      [groundLevel, activeLevel, ...walls].map((node) => [node.id, node]),
    )

    const target = resolveRoomRoofFootprint(activeLevel.id, nodes, [2, 1])

    expect(target?.wallIds).toHaveLength(4)
  })

  test('converts a lower-level room height into the active level frame', () => {
    const groundLevel = LevelNode.parse({ children: [], height: 3, level: 0 })
    const activeLevel = LevelNode.parse({ children: [], height: 3, level: 1 })
    const wall = WallNode.parse({
      parentId: groundLevel.id,
      start: [0, 0],
      end: [4, 0],
      height: 3,
    })
    const nodes = Object.fromEntries(
      [groundLevel, activeLevel, wall].map((node) => [node.id, node]),
    )
    const target = fitRoofFootprint(
      'room-ground',
      [
        [0, 0],
        [4, 0],
        [4, 3],
        [0, 3],
      ],
      [wall.id],
    )

    expect(target && resolveRoofFootprintElevation(activeLevel.id, target, nodes)).toBe(0)
    expect(target && resolveRoofFootprintWorldElevation(activeLevel.id, target, nodes)).toBe(3)
  })

  test('keeps a lower-level curved wall hover ghost in the active level world frame', () => {
    const groundLevel = LevelNode.parse({ children: [], height: 3, level: 0 })
    const activeLevel = LevelNode.parse({ children: [], height: 3, level: 1 })
    const wall = WallNode.parse({
      parentId: groundLevel.id,
      start: [-2, 0],
      end: [2, 0],
      curveOffset: 2,
      height: 3,
    })
    const nodes = Object.fromEntries(
      [groundLevel, activeLevel, wall].map((node) => [node.id, node]),
    )

    expect(resolveRoofWallTopWorldElevation(activeLevel.id, wall, nodes)).toBeCloseTo(3)
  })

  test('routes a curved wall click to conical wall placement', () => {
    const wall = WallNode.parse({ start: [-2, 0], end: [2, 0], curveOffset: 2 })
    const level = LevelNode.parse({ children: [wall.id], level: 0 })
    const wallOnLevel = { ...wall, parentId: level.id }
    const nodes = Object.fromEntries([level, wallOnLevel].map((node) => [node.id, node]))
    const selected: string[] = []
    const previewed: Array<string | null> = []
    let stopped = false
    const unsubscribe = subscribeToConicalRoofWallClicks({
      footprintSource: 'walls',
      currentLevelId: level.id,
      getNodes: () => nodes,
      onPreview: (previewWall) => previewed.push(previewWall?.id ?? null),
      onSelect: (selectedWall) => selected.push(selectedWall.id),
      roofType: 'conical',
    })

    emitter.emit('wall:enter', { node: wallOnLevel } as WallEvent)
    emitter.emit('wall:click', {
      node: wallOnLevel,
      stopPropagation: () => {
        stopped = true
      },
    } as WallEvent)
    emitter.emit('wall:leave', { node: wallOnLevel } as WallEvent)
    unsubscribe()

    expect(selected).toEqual([wall.id])
    expect(previewed).toEqual([wall.id, null])
    expect(stopped).toBe(true)
  })

  test('ignores curved walls more than one level below the active roof level', () => {
    const wall = WallNode.parse({
      parentId: 'level_ground',
      start: [-2, 0],
      end: [2, 0],
      curveOffset: 2,
    })
    const groundLevel = LevelNode.parse({ id: 'level_ground', children: [wall.id], level: 0 })
    const middleLevel = LevelNode.parse({ id: 'level_middle', children: [], level: 1 })
    const activeLevel = LevelNode.parse({ id: 'level_active', children: [], level: 2 })
    const nodes = Object.fromEntries(
      [groundLevel, middleLevel, activeLevel, wall].map((node) => [node.id, node]),
    )
    const previewed: Array<string | null> = []
    const selected: string[] = []
    const unsubscribe = subscribeToConicalRoofWallClicks({
      footprintSource: 'walls',
      currentLevelId: activeLevel.id,
      getNodes: () => nodes,
      onPreview: (previewWall) => previewed.push(previewWall?.id ?? null),
      onSelect: (selectedWall) => selected.push(selectedWall.id),
      roofType: 'conical',
    })

    emitter.emit('wall:enter', { node: wall } as WallEvent)
    emitter.emit('wall:click', { node: wall, stopPropagation: () => {} } as WallEvent)
    unsubscribe()

    expect(previewed).toEqual([])
    expect(selected).toEqual([])
  })

  test('ignores straight walls for conical roof hover and selection', () => {
    const wall = WallNode.parse({
      parentId: 'level_active',
      start: [0, 0],
      end: [4, 0],
    })
    const level = LevelNode.parse({ id: 'level_active', children: [wall.id], level: 0 })
    const nodes = Object.fromEntries([level, wall].map((node) => [node.id, node]))
    const previewed: Array<string | null> = []
    const selected: string[] = []
    const unsubscribe = subscribeToConicalRoofWallClicks({
      footprintSource: 'walls',
      currentLevelId: level.id,
      getNodes: () => nodes,
      onPreview: (previewWall) => previewed.push(previewWall?.id ?? null),
      onSelect: (selectedWall) => selected.push(selectedWall.id),
      roofType: 'conical',
    })

    emitter.emit('wall:enter', { node: wall } as WallEvent)
    emitter.emit('wall:click', { node: wall, stopPropagation: () => {} } as WallEvent)
    unsubscribe()

    expect(previewed).toEqual([])
    expect(selected).toEqual([])
  })
})

const RAIL = 3.5 * 0.0254
const H = RAIL / 2
const r6 = (value: number) => Math.round(value * 1e6) / 1e6

// A porch 6 m along a 0.2 m house wall at z 0, 2.5 m deep: invisible walls or railings round it.
function porchLevel(open: 'separators' | 'railings') {
  const level = LevelNode.parse({ id: 'level_porch', level: 0 })
  const house = WallNode.parse({
    id: 'wall_house',
    parentId: level.id,
    start: [0, 0],
    end: [10, 0],
    thickness: 0.2,
  })
  const sides: Array<[[number, number], [number, number]]> = [
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
      ? SeparatorNode.parse({ id: `separator_${i}`, parentId: level.id, start, end })
      : WallNode.parse({
          id: `wall_rail${i}`,
          parentId: level.id,
          start,
          end,
          wallType: 'railing',
          thickness: RAIL,
        }),
  )
  const zone = ZoneNode.parse({
    id: 'zone_porch',
    parentId: level.id,
    name: 'Porch',
    roomType: open === 'separators' ? 'porch' : 'deck',
    polygon: [
      [2, 0],
      [2, -2.5],
      [8, -2.5],
      [8, 0],
    ],
  })
  level.children = [house, ...edges, zone].map((node) => node.id) as LevelNode['children']
  return Object.fromEntries([level, house, ...edges, zone].map((node) => [node.id, node]))
}

const ends = (wall: WallNode) => [...wall.start, ...wall.end].map(r6)

describe("the rooms' edges a drawn roof snaps to", () => {
  test("a porch's invisible walls snap as walls do, on their lines", () => {
    const { references, faced } = roofSnapEdges(porchLevel('separators'), ['level_porch'])
    expect(references.map((reference) => reference.id)).toEqual([
      'separator_0',
      'separator_1',
      'separator_2',
    ])
    expect(references.map(ends)).toEqual([
      [2, 0, 2, -2.5],
      [2, -2.5, 8, -2.5],
      [8, -2.5, 8, 0],
    ])
    expect(references.every((reference) => isStandardRoofWallEligible(reference))).toBe(true)
    expect(faced.size).toBe(0)
  })

  test("a deck's railings snap at their outside faces, post corner to post corner", () => {
    const { references, faced } = roofSnapEdges(porchLevel('railings'), ['level_porch'])
    expect(references.map(ends)).toEqual([
      [2 - H, 0, 2 - H, -2.5 - H].map(r6),
      [2 - H, -2.5 - H, 8 + H, -2.5 - H].map(r6),
      [8 + H, -2.5 - H, 8 + H, 0].map(r6),
    ])
    expect([...faced].sort()).toEqual(['wall_rail0', 'wall_rail1', 'wall_rail2'])
  })

  test("a porch's corners and invisible walls' ends line a drawn roof up", () => {
    const deck = roofEdgeAnchors(porchLevel('railings'), ['level_porch'])
    const corner = deck.find((anchor) => anchor.nodeId === 'zone_porch' && anchor.x > 8)
    expect(corner && [r6(corner.x), r6(corner.z)]).toEqual([r6(8 + H), r6(-2.5 - H)])
    const porch = roofEdgeAnchors(porchLevel('separators'), ['level_porch'])
    expect(porch).toContainEqual({ nodeId: 'separator_1', kind: 'center', x: 5, z: -2.5 })
    expect(porch).toContainEqual({ nodeId: 'separator_0', kind: 'corner', x: 2, z: -2.5 })
  })

  test('the Room pick lights up a porch with its edges, a room with its walls', () => {
    const porch = resolveRoomRoofFootprint('level_porch', porchLevel('separators'), [5, -1])
    expect(roofFootprintPreviewIds(porch).sort()).toEqual([
      'separator_0',
      'separator_1',
      'separator_2',
      'wall_house',
    ])
    expect(roofFootprintPreviewIds(null)).toEqual([])
  })

  test("a railing's top never sets its roof's height", () => {
    const nodes = porchLevel('railings')
    const target = fitRoofFootprint(
      'deck',
      [
        [2, 0],
        [2, -2.5],
        [8, -2.5],
        [8, 0],
      ],
      ['wall_rail1' as WallNode['id']],
    )!
    const railing = { ...nodes.wall_rail1, height: 0.9 } as WallNode
    expect(
      resolveRoofFootprintElevation('level_porch', target, { ...nodes, wall_rail1: railing }),
    ).toBe(0)
  })
})

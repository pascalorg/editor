import { describe, expect, test } from 'bun:test'
import { area } from '../../lib/polygon-boolean'
import { type AnyNode, BuildingNode, DoorNode, LevelNode, WallNode, WindowNode } from '../../schema'
import { type Nodes, wallBodies, wallTrims } from './walls'

function scene(extra: AnyNode[] = []): Nodes {
  const building = BuildingNode.parse({ id: 'building_1', children: ['level_1'] })
  const level = LevelNode.parse({ id: 'level_1', parentId: 'building_1', level: 0, children: [] })
  return Object.fromEntries([building, level, ...extra].map((node) => [node.id, node])) as Nodes
}

const wall = (over: Record<string, unknown> = {}) =>
  WallNode.parse({
    id: 'wall_1',
    parentId: 'level_1',
    start: [0, 0],
    end: [6, 0],
    thickness: 0.1,
    children: [],
    ...over,
  })

const door = (over: Record<string, unknown> = {}) =>
  DoorNode.parse({
    id: 'door_1',
    parentId: 'wall_1',
    wallId: 'wall_1',
    position: [3, 1.05, 0],
    width: 0.9,
    height: 2.1,
    ...over,
  })

const pieceArea = (pieces: { outer: [number, number][]; holes: [number, number][][] }[]) =>
  area(pieces.map(({ outer, holes }) => ({ outer, holes })))

describe('wall bodies', () => {
  test('a plain wall is one prism over its footprint and height', () => {
    const nodes = scene([wall()])
    const prisms = wallBodies(nodes, 'level_1')
    expect(prisms).toHaveLength(1)
    expect(prisms[0]!.kind).toBe('wall')
    expect(prisms[0]!.z0).toBe(0)
    expect(prisms[0]!.z1).toBeGreaterThan(2.4)
    expect(pieceArea(prisms)).toBeCloseTo(6 * 0.1, 3)
  })

  test('a door takes its width out of the body and leaves a piece above its head', () => {
    const w = wall({ children: ['door_1'] })
    const nodes = scene([w, door()])
    const prisms = wallBodies(nodes, 'level_1')
    const body = prisms.filter((p) => p.id.endsWith('#body') || p.id.includes('#body.'))
    expect(pieceArea(body)).toBeCloseTo((6 - 0.9) * 0.1, 3)
    const above = prisms.filter((p) => p.id.includes('#above:door_1'))
    expect(above).toHaveLength(1)
    expect(above[0]!.z0).toBeCloseTo(2.1, 3)
    expect(pieceArea(above)).toBeCloseTo(0.9 * 0.1, 3)
    // nothing below a door that stands on the floor
    expect(prisms.some((p) => p.id.includes('#below:'))).toBe(false)
  })

  test('a window leaves a piece below its sill and above its head', () => {
    const w = wall({ children: ['window_1'] })
    const win = WindowNode.parse({
      id: 'window_1',
      parentId: 'wall_1',
      wallId: 'wall_1',
      position: [3, 1.5, 0],
      width: 1.2,
      height: 1.2,
    })
    const prisms = wallBodies(scene([w, win]), 'level_1')
    const below = prisms.find((p) => p.id.includes('#below:window_1'))!
    const above = prisms.find((p) => p.id.includes('#above:window_1'))!
    expect(below.z0).toBe(0)
    expect(below.z1).toBeCloseTo(0.9, 3)
    expect(above.z0).toBeCloseTo(2.1, 3)
  })

  test('a sloped wall stands to its taller end and is marked approximate', () => {
    const w = wall({ height: 2.5, endHeightOffset: -1, children: ['door_1'] })
    const prisms = wallBodies(scene([w, door({ position: [1, 1.05, 0] })]), 'level_1')
    expect(prisms.length).toBeGreaterThan(1)
    for (const prism of prisms) {
      expect(prism.z1).toBeCloseTo(2.5, 6)
      expect(prism.shape).toBe('approx')
      expect(prism.why).toBe('a sloped wall top: drawn at its taller end')
    }
    expect(wallBodies(scene([wall({ height: 2.5 })]), 'level_1')[0]!.shape).toBe('exact')
  })
})

describe('wall trims', () => {
  test('a skirting stands out of its face by its profile and stops at a door', () => {
    const w = wall({
      children: ['door_1'],
      skirting: { enabled: true, sides: 'a', height: 0.12, proud: 0.02, profile: 'flat' },
    })
    const { prisms } = wallTrims(scene([w, door()]), 'level_1')
    expect(prisms.length).toBeGreaterThan(0)
    expect(prisms.every((p) => p.kind === 'wall-trim' && p.host?.face === 'a')).toBe(true)
    // flat profile: the widest sample is 0.9 of proud
    const ys = prisms.flatMap((p) => p.outer.map(([, z]) => z))
    expect(Math.max(...ys.map(Math.abs))).toBeCloseTo(0.05 + 0.02 * 0.9, 3)
    // the door's 0.9 m is left out of the 6 m run
    expect(pieceArea(prisms)).toBeCloseTo((6 - 0.9 - 2 * 0) * 0.018, 2)
  })

  test('on a sloped wall the crown is approximate, the skirting exact', () => {
    const w = wall({
      height: 2.5,
      endHeightOffset: 0.8,
      skirting: { enabled: true, sides: 'a' },
      crown: { enabled: true, sides: 'a' },
    })
    const { prisms } = wallTrims(scene([w]), 'level_1')
    const crown = prisms.filter((p) => p.id.includes('#crown.'))
    const skirting = prisms.filter((p) => p.id.includes('#skirting.'))
    expect(crown.length).toBeGreaterThan(0)
    expect(skirting.length).toBeGreaterThan(0)
    expect(crown.every((p) => p.shape === 'approx')).toBe(true)
    expect(skirting.every((p) => p.shape === 'exact')).toBe(true)
  })

  test('a wall with no trim enabled adds none', () => {
    expect(wallTrims(scene([wall()]), 'level_1').prisms).toHaveLength(0)
  })
})

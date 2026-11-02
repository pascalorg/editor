import { describe, expect, test } from 'bun:test'
import { type AnyNode, BuildingNode, DoorNode, LevelNode, WallNode, WindowNode } from '../../schema'
import { openingBodies } from './openings'
import type { Prism } from './types'
import type { Nodes } from './walls'

function scene(extra: AnyNode[]): Nodes {
  const building = BuildingNode.parse({ id: 'building_1', children: ['level_1'] })
  const level = LevelNode.parse({ id: 'level_1', parentId: 'building_1', level: 0, children: [] })
  return Object.fromEntries([building, level, ...extra].map((node) => [node.id, node])) as Nodes
}

const wall = (children: string[]) =>
  WallNode.parse({
    id: 'wall_1',
    parentId: 'level_1',
    start: [0, 0],
    end: [6, 0],
    thickness: 0.1,
    children,
  })

const box = (p: Prism) => {
  const xs = p.outer.map(([x]) => x)
  const zs = p.outer.map(([, z]) => z)
  return { x0: Math.min(...xs), x1: Math.max(...xs), z0: Math.min(...zs), z1: Math.max(...zs) }
}

describe('door frames', () => {
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

  test('a door is passed between its jambs: the clear width is the width less two frame members', () => {
    const prisms = openingBodies(scene([wall(['door_1']), door()]), 'level_1')
    const left = prisms.find((p) => p.id.endsWith('#jamb.l'))!
    const right = prisms.find((p) => p.id.endsWith('#jamb.r'))!
    expect(left.kind).toBe('jamb')
    expect(box(left).x1).toBeCloseTo(2.6, 6)
    expect(box(right).x0).toBeCloseTo(3.4, 6)
    expect(box(right).x0 - box(left).x1).toBeCloseTo(0.9 - 2 * 0.05, 6)
    // a frame with no depth of its own is as deep as its wall (0.1), centred on the wall's body
    expect(box(left).z0).toBeCloseTo(-0.05, 6)
    expect(box(left).z1).toBeCloseTo(0.05, 6)
    expect([left.z0, left.z1]).toEqual([0, 2.1])
    expect(left.shape).toBe('exact')
  })

  test('the head and the threshold are the frame members across the opening', () => {
    const prisms = openingBodies(scene([wall(['door_1']), door()]), 'level_1')
    const head = prisms.find((p) => p.kind === 'door-head')!
    expect(head.z0).toBeCloseTo(2.05, 6)
    expect(head.z1).toBeCloseTo(2.1, 6)
    const threshold = prisms.find((p) => p.kind === 'threshold')!
    expect(threshold.z1 - threshold.z0).toBeCloseTo(0.02, 6)
    expect(box(threshold).x1 - box(threshold).x0).toBeCloseTo(0.8, 6)
  })

  test('a frameless opening has no frame', () => {
    expect(
      openingBodies(scene([wall(['door_1']), door({ openingKind: 'opening' })]), 'level_1'),
    ).toHaveLength(0)
  })

  test('an arched head leaves the head out and the door approximate', () => {
    const prisms = openingBodies(
      scene([wall(['door_1']), door({ openingShape: 'arch' })]),
      'level_1',
    )
    expect(prisms.some((p) => p.kind === 'door-head')).toBe(false)
    expect(prisms.filter((p) => p.kind === 'jamb').every((p) => p.shape === 'approx')).toBe(true)
  })
})

describe('window frames and sills', () => {
  const win = (over: Record<string, unknown> = {}) =>
    WindowNode.parse({
      id: 'window_1',
      parentId: 'wall_1',
      wallId: 'wall_1',
      position: [3, 1.5, 0],
      width: 1.2,
      height: 1.2,
      ...over,
    })

  test('the frame fills the opening and the sill stands under it on the side the window faces', () => {
    const prisms = openingBodies(scene([wall(['window_1']), win()]), 'level_1')
    const frame = prisms.find((p) => p.kind === 'window-frame')!
    expect([frame.z0, frame.z1]).toEqual([0.9, 2.1])
    expect(box(frame).x1 - box(frame).x0).toBeCloseTo(1.2, 6)
    const sill = prisms.find((p) => p.kind === 'sill')!
    // the sill's top stands 1 mm over the opening's bottom, as the window builder lifts it
    expect(sill.z1).toBeCloseTo(0.9 + 0.001, 6)
    expect(sill.z1 - sill.z0).toBeCloseTo(0.03, 6)
    expect(box(sill).x1 - box(sill).x0).toBeCloseTo(1.2 + 0.08 * 0.4, 6)
    // starts on the wall face (0.05) when the frame runs through the wall, and stands out sillDepth,
    // on the +normal side of a window turned 0
    expect(box(sill).z0).toBeCloseTo(0.05, 6)
    expect(box(sill).z1).toBeCloseTo(0.13, 6)
    expect(sill.host).toEqual({ wallId: 'wall_1', face: 'a' })
  })

  test('a window turned half a turn has its sill on the other side', () => {
    const prisms = openingBodies(
      scene([wall(['window_1']), win({ rotation: [0, Math.PI, 0] })]),
      'level_1',
    )
    const sill = prisms.find((p) => p.kind === 'sill')!
    expect(box(sill).z1).toBeCloseTo(-0.05, 6)
    expect(sill.host?.face).toBe('b')
  })

  test('a frame shallower than its wall keeps the sill 2 mm off the wall face', () => {
    const prisms = openingBodies(scene([wall(['window_1']), win({ frameDepth: 0.07 })]), 'level_1')
    expect(box(prisms.find((p) => p.kind === 'sill')!).z0).toBeCloseTo(0.052, 6)
  })

  test('no sill, no sill prism', () => {
    expect(
      openingBodies(scene([wall(['window_1']), win({ sill: false })]), 'level_1').some(
        (p) => p.kind === 'sill',
      ),
    ).toBe(false)
  })

  test('a bay window is approximate: its projection is not drawn', () => {
    const prisms = openingBodies(scene([wall(['window_1']), win({ windowType: 'bay' })]), 'level_1')
    expect(prisms.every((p) => p.shape === 'approx')).toBe(true)
  })
})

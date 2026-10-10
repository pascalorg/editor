import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import {
  type AnyNode,
  type AnyNodeDefinition,
  BuildingNode,
  DoorNode,
  ItemNode,
  LevelNode,
  loadPlugin,
  nodeRegistry,
  RoofNode,
  RoofSegmentNode,
  WallNode,
} from '@pascal-app/core'
import type { RevealEvent } from '@pascal-app/viewer'
import { wantFromEvent } from './follow-pascal-targets'

// What the camera looks at for each thing the reveal says: a floor when its walls rise, a window when
// it is cut in, an item when it drops, the roof from above as it assembles, and the whole house when
// the build is finished.

function house(at: [number, number, number] = [0, 0, 0]) {
  const building = BuildingNode.parse({ id: 'building_h', position: at })
  const level = LevelNode.parse({ id: 'level_h', parentId: building.id, level: 0, height: 2.7 })
  const roofLevel = LevelNode.parse({ id: 'level_roof', parentId: building.id, level: 1 })
  const corners: [number, number][] = [
    [0, 0],
    [10, 0],
    [10, 8],
    [0, 8],
  ]
  const walls = corners.map((start, index) =>
    WallNode.parse({
      id: `wall_${index}`,
      parentId: level.id,
      start,
      end: corners[(index + 1) % 4]!,
      frontSide: 'interior',
      backSide: 'exterior',
      height: 2.7,
    }),
  )
  const door = DoorNode.parse({
    id: 'door_h',
    parentId: walls[0]!.id,
    wallId: walls[0]!.id,
    position: [3, 1.05, 0],
    width: 0.9,
    height: 2.1,
  })
  const item = ItemNode.parse({
    id: 'item_h',
    parentId: level.id,
    position: [4, 0, 3],
    asset: {
      id: 'chair',
      category: 'furniture',
      name: 'Chair',
      thumbnail: '',
      src: '/items/chair/model.glb',
      dimensions: [0.6, 0.9, 0.6],
    },
  })
  const segment = RoofSegmentNode.parse({
    id: 'rseg_h',
    parentId: 'roof_h',
    roofType: 'gable',
    width: 10,
    depth: 8,
    pitch: 30,
    wallHeight: 0,
  })
  const roof = RoofNode.parse({
    id: 'roof_h',
    parentId: roofLevel.id,
    position: [5, 0, 4],
    children: [segment.id],
  })
  const list = [building, level, roofLevel, ...walls, door, item, roof, segment] as AnyNode[]
  const nodes = Object.fromEntries(list.map((node) => [node.id, { ...node }])) as Record<
    string,
    any
  >
  nodes.building_h.children = [level.id, roofLevel.id]
  nodes.level_h.children = [...walls.map((wall) => wall.id), item.id]
  nodes.level_roof.children = [roof.id]
  nodes.wall_0.children = [door.id]
  return nodes as Record<string, AnyNode>
}

const group = (
  type: 'start' | 'land' | 'settle',
  phase: string,
  ids: string[],
  levelId: string | null = 'level_h',
) =>
  ({ type, phase, levelId, nodeIds: ids, source: 'agent', instant: false, atMs: 0 }) as RevealEvent
const started = (id: string, phase: string, style = 'drop') =>
  ({
    type: 'node-start',
    id,
    phase,
    levelId: 'level_h',
    style,
    source: 'agent',
    atMs: 0,
  }) as RevealEvent

// The roof declares that it lifts for the furnishing; the kinds are the nodes package's, so a
// fixture of the same kind stands in for them here.
let restoreRegistry: () => void = () => {}
beforeAll(async () => {
  restoreRegistry = nodeRegistry._snapshot()
  nodeRegistry._reset()
  await loadPlugin({
    id: 'fixture:follow',
    apiVersion: 1,
    nodes: [
      {
        kind: 'roof',
        schemaVersion: 1,
        schema: RoofNode,
        category: 'structure',
        defaults: () => ({}),
        capabilities: {
          reveal: {
            phase: 'roof',
            style: 'assemble',
            height: 4,
            clears: { for: 'furnishing', height: 2.4 },
          },
        },
        geometry: () => null,
      } as unknown as AnyNodeDefinition,
    ],
  })
})
afterAll(() => restoreRegistry())

describe('what the camera looks at', () => {
  test('a floor, whole, when its slabs and walls start', () => {
    for (const phase of ['foundation', 'structure', 'circulation']) {
      const want = wantFromEvent(group('start', phase, ['wall_0']), house(), 1)!
      expect(want.kind).toBe('floor')
      expect(want.box.min[0]).toBeLessThanOrEqual(0)
      expect(want.box.max[0]).toBeGreaterThanOrEqual(10)
      expect(want.box.max[2]).toBeGreaterThanOrEqual(8)
      expect(want.at).toBe(1)
    }
  })

  test('the walls themselves are not targets: the floor already is', () => {
    expect(wantFromEvent(started('wall_1', 'structure', 'rise'), house(), 0)).toBeNull()
  })

  test('a window or a door close up, square to the wall it is in, from outside', () => {
    const want = wantFromEvent(started('door_h', 'openings', 'cut'), house(), 2)!
    expect(want.kind).toBe('detail')
    expect(want.box.max[1] - want.box.min[1]).toBeLessThan(2.5)
    expect(want.normal).toEqual([0, -1])
  })

  test('an item as furniture, from above', () => {
    const want = wantFromEvent(started('item_h', 'furnishing'), house(), 3)!
    expect(want.kind).toBe('furnish')
    expect(want.normal).toBeUndefined()
  })

  test('furniture is seen from above the roof that lifts for it', () => {
    const want = wantFromEvent(started('item_h', 'furnishing'), house(), 3)!
    // The roof's top is above 2.7 m; it lifts 2.4 m for the furniture, and the eye clears that.
    expect(want.eyeAbove).toBeGreaterThan(2.7 + 2.4)
    // A house with no roof has nothing to clear.
    const bare = house()
    delete (bare as Record<string, unknown>).roof_h
    delete (bare as Record<string, unknown>).rseg_h
    expect(wantFromEvent(started('item_h', 'furnishing'), bare, 3)!.eyeAbove).toBeUndefined()
  })

  test('the whole house once the furniture has landed, before the roof comes back down', () => {
    const want = wantFromEvent(group('settle', 'furnishing', ['item_h']), house(), 6)!
    expect(want.kind).toBe('group')
    expect(want.box.max[1]).toBeGreaterThan(3)
    expect(want.box.max[0]).toBeGreaterThanOrEqual(10)
    // Still looked down through the lifted roof, not from within it.
    expect(want.eyeAbove).toBeGreaterThan(2.7 + 2.4)
    // The walls settling say nothing about where to look.
    expect(wantFromEvent(group('settle', 'structure', ['wall_0']), house(), 6)).toBeNull()
  })

  test('a piece the agent moved is looked at like one it placed, and its settling does not pull back to the whole house', () => {
    const moved = { ...started('item_h', 'furnishing', 'glide'), changed: true } as RevealEvent
    const want = wantFromEvent(moved, house(), 3)!
    expect(want.kind).toBe('furnish')
    expect(want.eyeAbove).toBeGreaterThan(2.7 + 2.4)
    // The build around it is not finishing: the camera stays where the piece is.
    const settled = { ...group('settle', 'furnishing', ['item_h']), changed: true } as RevealEvent
    expect(wantFromEvent(settled, house(), 6)).toBeNull()
  })

  test('the roof, from the group that assembles it', () => {
    const want = wantFromEvent(
      group('start', 'roof', ['roof_h', 'rseg_h'], 'level_roof'),
      house(),
      4,
    )!
    expect(want.kind).toBe('roof')
    expect(want.box.max[1]).toBeGreaterThan(2.7)
  })

  test('where the building stands, not at the origin', () => {
    const want = wantFromEvent(started('door_h', 'openings', 'cut'), house([20, 0, 30]), 0)!
    expect(want.box.min[0]).toBeGreaterThan(20)
    expect(want.box.min[2]).toBeGreaterThan(29)
  })

  test('the whole house, roof and all, when the build is finished', () => {
    const want = wantFromEvent(
      {
        type: 'finale',
        id: 'roof_h',
        phase: 'roof',
        levelId: 'level_roof',
        source: 'agent',
        atMs: 0,
      } as RevealEvent,
      house(),
      5,
    )!
    expect(want.kind).toBe('group')
    expect(want.box.max[1]).toBeGreaterThan(3)
    expect(want.box.max[0]).toBeGreaterThanOrEqual(10)
  })

  test('an undo is followed: what goes first is looked at, group by group', () => {
    const undone = (phase: string, nodeIds: string[], levelId: string | null = 'level_h') =>
      ({
        type: 'retract-start',
        phase,
        levelId,
        nodeIds,
        source: null,
        atMs: 0,
      }) as RevealEvent
    const furniture = wantFromEvent(undone('furnishing', ['item_h']), house(), 1)!
    expect(furniture.kind).toBe('furnish')
    // Seen from above the roof that is still up for it.
    expect(furniture.eyeAbove).toBeGreaterThan(2.7 + 2.4)
    const roof = wantFromEvent(undone('roof', ['roof_h', 'rseg_h'], 'level_roof'), house(), 2)!
    expect(roof.kind).toBe('roof')
    expect(roof.box.max[1]).toBeGreaterThan(2.7)
    const openings = wantFromEvent(undone('openings', ['door_h']), house(), 3)!
    expect(openings.kind).toBe('group')
    expect(openings.box.max[1]).toBeLessThan(2.5)
    // The walls going: the floor they stand on is what is looked at, by the walls themselves.
    const walls = wantFromEvent(undone('structure', ['wall_0', 'wall_2']), house(), 4)!
    expect(walls.kind).toBe('floor')
    expect(walls.box.max[0]).toBeGreaterThanOrEqual(10)
    // A group whose nodes are no longer in the scene says nothing about where to look.
    expect(wantFromEvent(undone('structure', ['wall_gone']), house(), 5)).toBeNull()
    // The end of a group says nothing.
    expect(
      wantFromEvent(
        { ...undone('structure', ['wall_0']), type: 'retract-end' } as RevealEvent,
        house(),
        6,
      ),
    ).toBeNull()
  })

  test('nothing to look at for what says nothing about the scene', () => {
    expect(wantFromEvent(group('land', 'structure', ['wall_0']), house(), 0)).toBeNull()
    expect(wantFromEvent(group('settle', 'structure', ['wall_0']), house(), 0)).toBeNull()
    expect(
      wantFromEvent(
        {
          type: 'complete',
          nodeCount: 1,
          durationMs: 1,
          source: null,
          instant: false,
          atMs: 0,
        } as RevealEvent,
        house(),
        0,
      ),
    ).toBeNull()
    // A node that is gone is no target either.
    expect(wantFromEvent(started('item_gone', 'furnishing'), house(), 0)).toBeNull()
  })
})

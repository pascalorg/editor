import { describe, expect, test } from 'bun:test'
import {
  type AnyNode,
  BuildingNode,
  ColumnNode,
  DoorNode,
  getWallCurveFrameAt,
  getWallCurveLength,
  ImportedMeshNode,
  ItemNode,
  LevelNode,
  nodeRegistry,
  registerNode,
  SeparatorNode,
  SiteNode,
  SlabNode,
  WallNode,
  ZoneNode,
} from '@pascal-app/core'
import { z } from 'zod'
import { pointTargetScope } from './target-scope'

const rectangle = (x = 0, z = 0, width = 4, depth = 4): [number, number][] => [
  [x, z],
  [x + width, z],
  [x + width, z + depth],
  [x, z + depth],
]

function scene() {
  const nodes: Record<string, AnyNode> = {}
  const add = <T extends AnyNode>(node: T): T => {
    nodes[node.id] = node
    const parent = node.parentId ? nodes[node.parentId] : undefined
    const children: string[] | undefined =
      parent && 'children' in parent ? parent.children : undefined
    if (children && !children.includes(node.id)) children.push(node.id)
    return node
  }
  const site = add(SiteNode.parse({}))
  const building = add(BuildingNode.parse({ parentId: site.id }))
  const level = add(LevelNode.parse({ parentId: building.id }))
  const upstairs = add(LevelNode.parse({ parentId: building.id, level: 1 }))
  const room = add(
    ZoneNode.parse({
      parentId: level.id,
      name: 'Kitchen',
      polygon: rectangle(),
      spaceRole: 'room',
    }),
  )
  const item = (position: [number, number, number], parentId: string = level.id) =>
    add(
      ItemNode.parse({
        parentId,
        position,
        asset: {
          id: 'fixture',
          name: 'Chair',
          category: 'furniture',
          thumbnail: '',
          src: 'https://example.invalid/chair.glb',
          dimensions: [1, 1, 1],
        },
      }),
    )
  const scope = (before = nodes, current = nodes, targets = [room.id]) =>
    pointTargetScope(targets, before, current)
  return { nodes, add, site, building, level, upstairs, room, item, scope }
}

describe('a pointed room includes spatial siblings without including its whole level', () => {
  test('includes furnishing, columns, captured meshes and polygon centres, not ancestors or another room', () => {
    const s = scene()
    const fridge = s.item([2, 0, 2])
    const column = s.add(ColumnNode.parse({ parentId: s.level.id, position: [1, 0, 1] }))
    const mesh = s.add(ImportedMeshNode.parse({ parentId: s.level.id, position: [3, 0, 3] }))
    const slab = s.add(SlabNode.parse({ parentId: s.level.id, polygon: rectangle(1, 1, 2, 2) }))
    const outside = s.item([8, 0, 2])
    const upper = s.item([2, 0, 2], s.upstairs.id)
    const otherRoom = s.add(
      ZoneNode.parse({ parentId: s.level.id, name: 'Overlay', polygon: rectangle() }),
    )
    const before = structuredClone(s.nodes)

    const scope = s.scope()

    for (const node of [s.room, fridge, column, mesh, slab]) expect(scope.has(node.id)).toBe(true)
    for (const node of [outside, upper, otherRoom, s.level, s.upstairs, s.building, s.site])
      expect(scope.has(node.id)).toBe(false)
    expect(s.nodes).toEqual(before)
  })

  test('includes boundary rims, excludes hole interiors', () => {
    const s = scene()
    s.room.holes = [rectangle(1, 1, 2, 2)]
    const hole = s.item([2, 0, 2])
    const holeRim = s.item([1, 0, 2])
    const outerRim = s.item([0, 0, 2])

    const scope = s.scope()

    expect(scope.has(hole.id)).toBe(false)
    expect(scope.has(holeRim.id)).toBe(true)
    expect(scope.has(outerRim.id)).toBe(true)
  })

  test('uses declared custom footprints rather than the node origin, with the snapshot context', () => {
    const s = scene()
    const restore = nodeRegistry._snapshot()
    const schema = ItemNode.extend({ type: z.literal('test:point-footprint') })
    let applies = true
    let calls = 0
    try {
      registerNode({
        kind: 'test:point-footprint',
        schemaVersion: 1,
        schema,
        category: 'furnish',
        defaults: () => ({}),
        capabilities: {
          floorPlaced: {
            applies: () => applies,
            footprint: (_node, context) => {
              calls += 1
              expect(context?.nodes).toBe(s.nodes)
              return { dimensions: [1, 1, 1], rotation: [0, 0, 0], position: [2, 0, 2] }
            },
          },
        },
      })
      // Registered extension kinds are not represented in core's static builtin union.
      const custom = s.add(
        schema.parse({
          ...s.item([8, 0, 8]),
          id: 'item_custom_scope',
          type: 'test:point-footprint',
        }) as unknown as AnyNode,
      )
      expect(s.scope().has(custom.id)).toBe(true)
      const resolved = calls
      applies = false
      expect(s.scope().has(custom.id)).toBe(false)
      expect(calls).toBe(resolved)
    } finally {
      restore()
    }
  })

  test('keeps descendants of a scoped member even when their own centre is outside', () => {
    const s = scene()
    const table = s.item([2, 0, 2])
    const child = s.item([20, 1, 20], table.id)
    const nested = s.item([20, 1, 20], child.id)
    expect(s.scope().has(nested.id)).toBe(true)
  })

  test('composes nested local position and rotation when the parent centre is outside', () => {
    const s = scene()
    const table = s.item([6, 0, 2])
    table.rotation = [0, Math.PI / 2, 0]
    const child = s.item([0, 1, -3], table.id)

    const scope = s.scope()

    expect(scope.has(table.id)).toBe(false)
    expect(scope.has(child.id)).toBe(true)
  })

  test('compares level-local coordinates despite a translated and rotated building', () => {
    const s = scene()
    s.building.position = [100, 0, 100]
    s.building.rotation = [0, Math.PI / 2, 0]
    const item = s.item([2, 0, 2])
    expect(s.scope().has(item.id)).toBe(true)
  })
})

describe('room bounding walls and their hosts', () => {
  test('ignores invalid stored boundary kinds and walls on another level', () => {
    const s = scene()
    const upperWall = s.add(WallNode.parse({ parentId: s.upstairs.id, start: [8, 0], end: [8, 4] }))
    s.room.boundaryWallIds = [s.level.id as never, upperWall.id]
    const upperChild = s.item([2, 1, 0], upperWall.id)
    const outside = s.item([8, 0, 8])

    const scope = s.scope()

    for (const node of [s.level, upperWall, upperChild, outside])
      expect(scope.has(node.id)).toBe(false)
  })

  test('includes stored inset boundaries, explicit wallId-only openings and descendants', () => {
    const s = scene()
    s.room.polygon = rectangle(0.2, 0.2, 3.6, 3.6)
    const wall = s.add(WallNode.parse({ parentId: s.level.id, start: [0, 0], end: [4, 0] }))
    s.room.boundaryWallIds = [wall.id]
    const door = s.add(
      DoorNode.parse({ parentId: s.level.id, wallId: wall.id, position: [2, 1, 0] }),
    )
    const picture = s.item([2, 1, 0], wall.id)
    picture.wallId = wall.id
    const nested = s.item([20, 1, 20], picture.id)

    const scope = s.scope()

    for (const node of [wall, door, picture, nested]) expect(scope.has(node.id)).toBe(true)
  })

  test('infers bounding walls for a hand-drawn inset room without stored associations', () => {
    const s = scene()
    s.room.polygon = rectangle(0.2, 0.2, 3.6, 3.6)
    const polygon = rectangle()
    const walls = polygon.map((start, index) =>
      s.add(
        WallNode.parse({
          parentId: s.level.id,
          start,
          end: polygon[(index + 1) % polygon.length],
        }),
      ),
    )
    const remote = s.add(WallNode.parse({ parentId: s.level.id, start: [10, 0], end: [10, 4] }))

    const scope = s.scope()

    for (const wall of walls) expect(scope.has(wall.id)).toBe(true)
    expect(scope.has(remote.id)).toBe(false)
  })

  test('a party wall belongs to both rooms and separators retain their children', () => {
    const s = scene()
    const neighbor = s.add(
      ZoneNode.parse({ parentId: s.level.id, name: 'Living', polygon: rectangle(4, 0) }),
    )
    const party = s.add(WallNode.parse({ parentId: s.level.id, start: [4, 0], end: [4, 4] }))
    const separator = s.add(
      SeparatorNode.parse({ parentId: s.level.id, start: [0, 0], end: [4, 0] }),
    )
    s.room.boundarySeparatorIds = [separator.id]
    const child = s.item([20, 0, 20], separator.id)

    expect(s.scope().has(party.id)).toBe(true)
    expect(s.scope(s.nodes, s.nodes, [neighbor.id]).has(party.id)).toBe(true)
    expect(s.scope().has(child.id)).toBe(true)
  })

  test('does not mistake a remote wall-hosted local station for a room coordinate', () => {
    const s = scene()
    const remote = s.add(WallNode.parse({ parentId: s.level.id, start: [8, 0], end: [8, 4] }))
    const picture = s.item([2, 1, 0], remote.id)
    picture.wallId = remote.id
    expect(s.scope().has(picture.id)).toBe(false)
  })

  test('uses the curved wall station for a hosted member, not its chord', () => {
    const s = scene()
    const wall = s.add(
      WallNode.parse({ parentId: s.level.id, start: [6, -2], end: [6, 6], curveOffset: 4 }),
    )
    const middle = getWallCurveFrameAt(wall, 0.5).point
    s.room.polygon = rectangle(middle.x - 0.5, middle.y - 0.5, 1, 1)
    const picture = s.item([getWallCurveLength(wall) / 2, 1, 0], wall.id)
    picture.wallId = wall.id
    expect(s.scope().has(picture.id)).toBe(true)
  })
})

describe('membership before or after the write', () => {
  test('retains moved-out members and recognizes moved-in members', () => {
    const s = scene()
    const out = s.item([2, 0, 2])
    const incoming = s.item([8, 0, 2])
    const before = structuredClone(s.nodes)
    out.position = [8, 0, 2]
    incoming.position = [2, 0, 2]
    const scope = s.scope(before)
    expect(scope.has(out.id)).toBe(true)
    expect(scope.has(incoming.id)).toBe(true)
  })

  test('retains a deleted member and a member reparented to another level', () => {
    const s = scene()
    const deleted = s.item([2, 0, 2])
    const moved = s.item([2, 0, 2])
    const before = structuredClone(s.nodes)
    delete s.nodes[deleted.id]
    moved.parentId = s.upstairs.id
    s.level.children = s.level.children.filter((id) => id !== moved.id && id !== deleted.id)
    s.upstairs.children.push(moved.id)
    const scope = s.scope(before)
    expect(scope.has(deleted.id)).toBe(true)
    expect(scope.has(moved.id)).toBe(true)
  })

  test('uses each snapshot room footprint and retains a deleted zone', () => {
    const s = scene()
    const oldMember = s.item([2, 0, 2])
    const newMember = s.item([10, 0, 2])
    const before = structuredClone(s.nodes)
    s.room.polygon = rectangle(8, 0)
    expect(s.scope(before).has(oldMember.id)).toBe(true)
    expect(s.scope(before).has(newMember.id)).toBe(true)
    delete s.nodes[s.room.id]
    expect(s.scope(before).has(oldMember.id)).toBe(true)
  })

  test('does not mix before-only membership with children created outside afterward', () => {
    const s = scene()
    const table = s.item([2, 0, 2])
    const before = structuredClone(s.nodes)
    table.position = [8, 0, 8]
    const outsideChild = s.item([0, 1, 0], table.id)
    const scope = s.scope(before)
    expect(scope.has(table.id)).toBe(true)
    expect(scope.has(outsideChild.id)).toBe(false)
  })

  test('retains ordinary target ancestry before reparenting and terminates on cycles', () => {
    const s = scene()
    const target = s.item([8, 0, 8])
    const child = s.item([1, 1, 1], target.id)
    const before = structuredClone(s.nodes)
    target.children = []
    child.parentId = s.level.id
    expect(pointTargetScope([target.id], before, s.nodes).has(child.id)).toBe(true)
    target.parentId = child.id
    child.parentId = target.id
    target.children = [child.id]
    child.children = [target.id]
    expect(new Set(pointTargetScope([target.id], s.nodes, s.nodes))).toEqual(
      new Set([target.id, child.id]),
    )
  })
})

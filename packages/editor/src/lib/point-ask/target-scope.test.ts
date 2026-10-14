import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  type AnyNode,
  BlockNode,
  BuildingNode,
  ColumnNode,
  createBoxBlockTopology,
  DoorNode,
  getBlockFaceFrame,
  getFloorPlacedFootprints,
  getScaledDimensions,
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
import { nodeLevelFrame } from '@pascal-app/core/procedural-items'
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

function expectLevelPosition(
  node: AnyNode,
  nodes: Record<string, AnyNode>,
  expected: [number, number, number],
) {
  const position = nodeLevelFrame(node.id, nodes).position
  for (let axis = 0; axis < 3; axis++) expect(position[axis]).toBeCloseTo(expected[axis]!, 8)
}

describe('room membership uses hosting frames, not model frames', () => {
  let restoreRegistry = () => {}
  beforeEach(() => {
    restoreRegistry = nodeRegistry._snapshot()
    nodeRegistry._reset()
    // Headless public registry definition: the real schema and scaled-footprint
    // helper, without importing the host-only nodes plugin into the editor.
    registerNode({
      kind: 'item',
      schemaVersion: 1,
      schema: ItemNode,
      category: 'furnish',
      defaults: () => ({}),
      capabilities: {
        floorPlaced: {
          applies: (node) => node.type === 'item' && !node.asset.attachTo,
          footprint: (node) => {
            if (node.type !== 'item') throw new Error('Expected an item footprint')
            return { dimensions: getScaledDimensions(node), rotation: node.rotation }
          },
        },
      },
    })
  })
  afterEach(() => restoreRegistry())

  // Analytic oracles: room 0..4, host x=6; child x=-4 is inside at 2,
  // child x=-1.5 is outside at 4.5. Scale belongs to the mesh, not this sum.
  for (const scale of [
    [2, 3, 0.5],
    [0.5, 2, 3],
  ] satisfies [number, number, number][]) {
    test(`item mesh scale ${scale.join('/')} neither drops inside children nor admits outside ones`, () => {
      const s = scene()
      const host = s.item([6, 0, 2])
      host.scale = scale
      const inside = s.item([-4, 1, 0], host.id)
      const outside = s.item([-1.5, 1, 0], host.id)
      const before = structuredClone(s.nodes)

      expectLevelPosition(inside, s.nodes, [2, 1, 2])
      expectLevelPosition(outside, s.nodes, [4.5, 1, 2])
      const scope = s.scope()
      expect(scope.has(inside.id)).toBe(true)
      expect(scope.has(outside.id)).toBe(false)
      expect(scope.has(host.id)).toBe(false)
      expect(s.nodes).toEqual(before)
    })
  }

  test('a rotated item host turns metre offsets without stretching them', () => {
    const s = scene()
    const host = s.item([6, 0, 2])
    host.rotation = [0, Math.PI / 2, 0]
    host.scale = [0.5, 3, 2]
    const inside = s.item([0, 1, -4], host.id)
    const outside = s.item([0, 1, -1.5], host.id)

    expectLevelPosition(inside, s.nodes, [2, 1, 2])
    expectLevelPosition(outside, s.nodes, [4.5, 1, 2])
    const scope = s.scope()
    expect(scope.has(inside.id)).toBe(true)
    expect(scope.has(outside.id)).toBe(false)
    expect(scope.has(host.id)).toBe(false)
  })

  test('nested rotated hosts preserve child coordinates while its own footprint still scales', () => {
    const s = scene()
    const outer = s.item([10, 0, 2])
    outer.rotation = [0, Math.PI / 2, 0]
    outer.scale = [5, 2, 0.5]
    const inner = s.item([0, 1, -4], outer.id)
    inner.rotation = [0, -Math.PI / 2, 0]
    inner.scale = [2, 3, 4]
    const inside = s.item([-4, 1, 0], inner.id)
    inside.asset.dimensions = [2, 1, 3]
    inside.scale = [3, 2, 4]
    const outside = s.item([-1.5, 1, 0], inner.id)

    expectLevelPosition(inner, s.nodes, [6, 1, 2])
    expectLevelPosition(inside, s.nodes, [2, 2, 2])
    expectLevelPosition(outside, s.nodes, [4.5, 2, 2])
    const footprint = nodeRegistry.get('item')?.capabilities.floorPlaced
    if (!footprint) throw new Error('Missing registered item footprint')
    expect(getFloorPlacedFootprints(footprint, inside, { nodes: s.nodes })[0]?.dimensions).toEqual([
      6, 2, 12,
    ])
    const scope = s.scope()
    expect(scope.has(inside.id)).toBe(true)
    for (const node of [outer, inner, outside]) expect(scope.has(node.id)).toBe(false)
  })

  for (const change of ['moved', 'deleted', 'reparented'] as const) {
    test(`a ${change} child of a scaled host retains before membership without acquiring outside descendants`, () => {
      const s = scene()
      const host = s.item([6, 0, 2])
      host.scale = [2, 3, 4]
      const member = s.item([-4, 1, 0], host.id)
      const incoming = s.item([-1.5, 1, 0], host.id)
      const before = structuredClone(s.nodes)
      incoming.position = [-3, 1, 0]
      if (change === 'moved') member.position = [4, 1, 0]
      else {
        host.children = host.children.filter((id) => id !== member.id)
        if (change === 'deleted') delete s.nodes[member.id]
        else {
          member.parentId = s.upstairs.id
          s.upstairs.children.push(member.id)
        }
      }
      const outsideChild = s.item([0, 1, 0], change === 'deleted' ? host.id : member.id)

      expect(s.scope(before, before).has(member.id)).toBe(true)
      expect(s.scope().has(member.id)).toBe(false)
      const scope = s.scope(before)
      expect(scope.has(member.id)).toBe(true)
      expect(scope.has(incoming.id)).toBe(true)
      expect(scope.has(outsideChild.id)).toBe(false)
      expect(scope.has(host.id)).toBe(false)
    })
  }

  // A 4 x 2.4 x 4 box has its back face at z=2, right at x=2 and
  // top at y=2.4. Face UVs are not level XZ. Fixed expected points below
  // come from these planes and quarter-turns, never from Point's transform.
  const placements: {
    name: string
    faceId: string
    hostPosition: [number, number, number]
    hostRotation: number
    position: [number, number, number]
    expected: [number, number, number]
    wrongPlan: [number, number]
    nested?: boolean
  }[] = [
    {
      name: 'offset back face',
      faceId: 'f-back',
      hostPosition: [2, 0, 0],
      hostRotation: 0,
      position: [1, 0.3, 0.2],
      expected: [3, 1.5, 2.2],
      wrongPlan: [3, 0.2],
    },
    {
      name: 'rotated right face',
      faceId: 'f-right',
      hostPosition: [5, 0, 3],
      hostRotation: Math.PI / 2,
      position: [1, -0.2, 0.4],
      expected: [4, 1, 0.6],
      wrongPlan: [5.4, 2],
    },
    {
      name: 'top face',
      faceId: 'f-top',
      hostPosition: [2, 0, 3],
      hostRotation: 0,
      position: [0.75, 1, 0.2],
      expected: [2.75, 2.6, 2],
      wrongPlan: [2.75, 3.2],
    },
    {
      name: 'nested rotated back face',
      faceId: 'f-back',
      hostPosition: [0, 1, -4],
      hostRotation: Math.PI / 2,
      position: [0.75, 0.2, 0.3],
      expected: [5.25, 2.4, 3.7],
      wrongPlan: [5.25, 5.7],
      nested: true,
    },
  ]
  for (const placement of placements) {
    test(`${placement.name} includes the attachment's room, not its naive planar projection`, () => {
      const s = scene()
      const parent = placement.nested ? s.item([10, 0, 6]) : s.level
      if (parent.type === 'item') {
        parent.rotation = [0, Math.PI / 2, 0]
        parent.scale = [2, 3, 4]
      }
      const block = s.add(
        BlockNode.parse({
          parentId: parent.id,
          position: placement.hostPosition,
          rotation: placement.hostRotation,
          topology: createBoxBlockTopology(4, 2.4, 4),
        }),
      )
      const face = getBlockFaceFrame(block.topology, placement.faceId)
      expect(face).not.toBeNull()
      const attached = s.item(placement.position, block.id)
      attached.blockFaceId = placement.faceId
      if (placement.faceId === 'f-top') attached.rotation = [Math.PI / 2, 0, 0]
      else attached.asset.attachTo = 'wall'
      const [x, , z] = placement.expected
      s.room.polygon = rectangle(x - 0.25, z - 0.25, 0.5, 0.5)
      const wrongRoom = s.add(
        ZoneNode.parse({
          parentId: s.level.id,
          name: 'Wrong planar projection',
          polygon: rectangle(
            placement.wrongPlan[0] - 0.25,
            placement.wrongPlan[1] - 0.25,
            0.5,
            0.5,
          ),
        }),
      )

      expectLevelPosition(attached, s.nodes, placement.expected)
      const scope = s.scope()
      expect(scope.has(attached.id)).toBe(true)
      expect(scope.has(block.id)).toBe(false)
      expect(scope.has(parent.id)).toBe(false)
      const wrongScope = s.scope(s.nodes, s.nodes, [wrongRoom.id])
      expect(wrongScope.has(block.id)).toBe(false)
      expect(wrongScope.has(attached.id)).toBe(false)
    })
  }

  test('descendants use the rotated block attachment frame even when the attachment itself is outside', () => {
    const s = scene()
    const block = s.add(
      BlockNode.parse({
        parentId: s.level.id,
        position: [2, 0, 0],
        topology: createBoxBlockTopology(4, 2.4, 4),
      }),
    )
    const attached = s.item([1, 0.3, 0.2], block.id)
    attached.blockFaceId = 'f-back'
    attached.asset.attachTo = 'wall'
    attached.rotation = [0, Math.PI / 2, 0]
    attached.scale = [2, 3, 4]
    const child = s.item([0, 1, -2], attached.id)
    s.room.polygon = rectangle(0.75, 1.95, 0.5, 0.5)

    expectLevelPosition(attached, s.nodes, [3, 1.5, 2.2])
    expectLevelPosition(child, s.nodes, [1, 2.5, 2.2])
    const scope = s.scope()
    expect(scope.has(child.id)).toBe(true)
    expect(scope.has(attached.id)).toBe(false)
    expect(scope.has(block.id)).toBe(false)
  })

  test('a moved block attachment stays in the before/current union, not its new outside sibling', () => {
    const s = scene()
    const block = s.add(
      BlockNode.parse({
        parentId: s.level.id,
        position: [2, 0, 0],
        topology: createBoxBlockTopology(4, 2.4, 4),
      }),
    )
    const attached = s.item([1, 0.3, 0.2], block.id)
    attached.blockFaceId = 'f-back'
    s.room.polygon = rectangle(2.75, 1.95, 0.5, 0.5)
    const before = structuredClone(s.nodes)
    block.position = [12, 0, 0]
    const outside = s.item([1, 0.3, 0.2], block.id)
    outside.blockFaceId = 'f-back'

    expect(s.scope(before, before).has(attached.id)).toBe(true)
    expect(s.scope().has(attached.id)).toBe(false)
    const scope = s.scope(before)
    expect(scope.has(attached.id)).toBe(true)
    expect(scope.has(outside.id)).toBe(false)
    expect(scope.has(block.id)).toBe(false)
  })
})

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

import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { area, containsPoint, distanceToBoundary, type Ring } from '../lib/polygon-boolean'
import { detectRoomFaces } from '../lib/room-graph'
import { createRoomTopologyIndex } from '../lib/space-detection'
import { reconcileLevelStructure } from '../lib/structure-kernel'
import {
  type AnyNode,
  CeilingNode,
  LevelNode,
  SeparatorNode,
  SlabNode,
  WallNode,
  ZoneNode,
} from '../schema'
import {
  ensureSceneOpenings,
  healSceneNodes,
  migrateCeilingRoomLinks,
  migrateFloorPlates,
  migrateRoomZones,
  migrateSlabSlots,
  migrateVerticalSceneNodes,
  migrateWallFaceBands,
  migrateWallFaceKeys,
  normalizeLegacyStructure,
  reconcileStructureOnLoad,
} from './scene-migrations'

type Nodes = Record<string, any>
const rectangle = (x = 0, y = 0, width = 10, height = 10): Ring => [
  [x, y],
  [x + width, y],
  [x + width, y + height],
  [x, y + height],
]
function walls(polygon: Ring, prefix = 'outer', levelId = 'level_main') {
  return polygon.map((start, i) =>
    WallNode.parse({
      id: `wall_${prefix}_${i}`,
      parentId: levelId,
      start,
      end: polygon[(i + 1) % polygon.length],
    }),
  )
}
function scene(polygon = rectangle(), levelId = 'level_main'): Nodes {
  const boundary = walls(polygon, 'outer', levelId)
  const level = LevelNode.parse({ id: levelId, children: boundary.map((wall) => wall.id) })
  return Object.fromEntries([level, ...boundary].map((node) => [node.id, node]))
}
function add(nodes: Nodes, node: any) {
  nodes[node.id] = node
  nodes[node.parentId].children.push(node.id)
}
function zones(nodes: Record<string, unknown>): ZoneNode[] {
  return Object.values(nodes).filter((node: any) => node.type === 'zone') as ZoneNode[]
}
function freeze(value: any) {
  if (!value || typeof value !== 'object') return
  for (const child of Object.values(value)) freeze(child)
  Object.freeze(value)
}

describe('M3 room zones', () => {
  test('creates schema-complete reachable rooms, is pure, deterministic, and byte-idempotent', () => {
    const source = scene()
    freeze(source)
    const first = migrateRoomZones(source)
    expect(first.createdZoneIds).toHaveLength(1)
    const id = first.createdZoneIds[0]!
    expect(id).toMatch(/^zone_[a-z0-9]{16}$/)
    expect(first.adoptedZoneIds).toEqual([])
    const room = zones(first.nodes)[0]!
    expect(ZoneNode.parse(room)).toEqual(room)
    expect(room).toMatchObject({
      name: 'Room 1',
      color: '#3b82f6',
      parentId: 'level_main',
      seed: [5, 5],
      holes: [],
      boundarySeparatorIds: [],
    })
    expect((first.nodes.level_main as any).children).toEqual([...source.level_main.children, id])
    expect(zones(source)).toEqual([])
    expect(migrateRoomZones(source).createdZoneIds).toEqual(first.createdZoneIds)
    const second = migrateRoomZones(first.nodes)
    expect(JSON.stringify(second.nodes)).toBe(JSON.stringify(first.nodes))
    expect(second.nodes).toBe(first.nodes)
    expect(second.createdZoneIds).toEqual([])
    expect(second.adoptedZoneIds).toEqual([])
    expect(migrateRoomZones(scene(rectangle(), 'level_other')).createdZoneIds).not.toEqual(
      first.createdZoneIds,
    )
    expect(
      migrateRoomZones(Object.fromEntries(Object.entries(source).reverse())).createdZoneIds,
    ).toEqual(first.createdZoneIds)
  })

  for (const spaceRole of [undefined, 'generic', 'room']) {
    test(`adopts a matching ${spaceRole ?? 'role-less'} zone and preserves authored data and seed`, () => {
      const source = scene()
      const legacy = {
        id: 'zone_existing',
        type: 'zone',
        parentId: 'level_main',
        polygon: rectangle(0, 0, 9.5, 10),
        name: 'Kitchen',
        color: '#abcdef',
        seed: [2, 2],
        floorFinish: 'Timber',
        wallFinish: 'Paint',
        ceilingFinish: 'ACT',
        ceilingHeight: 3.2,
        floor: { finish: 'library:oak' },
        ...(spaceRole ? { spaceRole } : {}),
      }
      add(source, legacy)
      const migrated = migrateRoomZones(source)
      expect(migrated.createdZoneIds).toEqual([])
      expect(migrated.adoptedZoneIds).toEqual([legacy.id])
      expect(migrated.nodes[legacy.id]).toMatchObject({
        ...legacy,
        polygon: rectangle(),
        spaceRole: 'room',
        autoFromWalls: true,
        boundaryWallIds: Object.values(source)
          .filter((n) => n.type === 'wall')
          .map((n) => n.id)
          .sort(),
        boundarySeparatorIds: [],
        holes: [],
      })
      expect(JSON.stringify(migrateRoomZones(migrated.nodes).nodes)).toBe(
        JSON.stringify(migrated.nodes),
      )
    })
  }

  for (const [label, polygon, adopted] of [
    ['covers half the face', rectangle(0, 0, 5, 10), true],
    ['covers just under half the face', rectangle(0, 0, 4.999, 10), false],
    ['has half its area outside the face', rectangle(-5, 0, 10, 10), true],
    ['has most of its area outside the face', rectangle(-5.2, 0, 10.2, 10), false],
  ] as const) {
    test(`adoption threshold: a zone that ${label}`, () => {
      const source = scene()
      for (const wall of Object.values(source)) if (wall.type === 'wall') wall.thickness = 0
      add(source, {
        id: 'zone_threshold',
        type: 'zone',
        parentId: 'level_main',
        name: 'Existing',
        polygon,
      })
      const result = migrateRoomZones(source)
      expect(result.adoptedZoneIds).toEqual(adopted ? ['zone_threshold'] : [])
      expect(result.createdZoneIds.length).toBe(adopted ? 0 : 1)
    })
  }

  test('leaves unmatched generic zones untouched, including one with the same bounds', () => {
    const source = scene()
    const generic = ZoneNode.parse({
      id: 'zone_analysis',
      parentId: 'level_main',
      name: 'Analysis',
      polygon: [
        [0, 0],
        [10, 0],
        [10, 1],
        [1, 1],
        [1, 10],
        [0, 10],
      ],
    })
    add(source, generic)
    const result = migrateRoomZones(source)
    expect(result.nodes[generic.id]).toBe(generic)
    expect(result.createdZoneIds).toHaveLength(1)
  })

  test('only adopts same-level zones and does not overwrite an occupied deterministic id', () => {
    const source = scene()
    const id = migrateRoomZones(source).createdZoneIds[0]!
    const unrelated = ZoneNode.parse({
      id,
      parentId: 'level_other',
      name: 'Analysis',
      polygon: rectangle(),
    })
    source[id] = unrelated
    const result = migrateRoomZones(source)
    expect(result.nodes[id]).toBe(unrelated)
    expect(result.createdZoneIds[0]).not.toBe(id)
    expect(migrateRoomZones(source).createdZoneIds).toEqual(result.createdZoneIds)
    expect(migrateRoomZones(result.nodes).createdZoneIds).toEqual([])
  })

  test('nested rooms match topology holes, subtract holes for IoU, and seed inside usable area', () => {
    const source = scene()
    for (const wall of walls(rectangle(3, 3, 4, 4), 'inner')) add(source, wall)
    const oldOuter = ZoneNode.parse({
      id: 'zone_filled_outer',
      parentId: 'level_main',
      name: 'Analysis',
      polygon: rectangle(),
    })
    add(source, oldOuter)
    const result = migrateRoomZones(source)
    // The filled zone holds 84 % of its area in the ring face and covers all of it.
    expect(result.createdZoneIds).toHaveLength(1)
    expect(result.adoptedZoneIds).toEqual([oldOuter.id])
    expect((result.nodes[oldOuter.id] as ZoneNode).holes).toHaveLength(1)
    expect((result.nodes[oldOuter.id] as ZoneNode).name).toBe('Analysis')
    const rooms = zones(result.nodes).filter((zone) => zone.autoFromWalls)
    const outer = rooms.find((zone) => zone.holes.length === 1)!
    const inner = rooms.find((zone) => zone.holes.length === 0)!
    expect(outer.boundaryWallIds).toHaveLength(8)
    expect(inner.boundaryWallIds).toHaveLength(4)
    expect(area([{ outer: outer.polygon, holes: outer.holes }])).toBe(84)
    for (const room of rooms) {
      const polygon = [{ outer: room.polygon, holes: room.holes }]
      expect(containsPoint(polygon, room.seed!)).toBe(true)
      expect(distanceToBoundary(polygon, room.seed!)).toBeGreaterThan(0)
    }
    const index = createRoomTopologyIndex()
    index.rebuild(source)
    const topology = index.getLevelTopology('level_main')!
    expect(rooms.map((room) => ({ polygon: room.polygon, holes: room.holes }))).toEqual(
      topology.rooms.map((room) => ({ polygon: room.polygon, holes: room.holes })),
    )
    expect(JSON.stringify(migrateRoomZones(result.nodes).nodes)).toBe(JSON.stringify(result.nodes))
  })

  test('adopts a holed zone regardless of ring winding', () => {
    const source = scene()
    for (const wall of walls(rectangle(3, 3, 4, 4), 'inner')) add(source, wall)
    add(
      source,
      ZoneNode.parse({
        id: 'zone_ring',
        parentId: 'level_main',
        name: 'Hall',
        polygon: rectangle().reverse(),
        holes: [rectangle(3, 3, 4, 4)],
      }),
    )
    expect(migrateRoomZones(source).adoptedZoneIds).toEqual(['zone_ring'])
  })

  test('concave faces use an interior pole when the area centroid lies outside', () => {
    const polygon: Ring = [
      [0, 0],
      [10, 0],
      [10, 2],
      [2, 2],
      [2, 10],
      [0, 10],
    ]
    const room = zones(migrateRoomZones(scene(polygon)).nodes)[0]!
    expect(containsPoint([{ outer: polygon, holes: [] }], room.seed!)).toBe(true)
    expect(distanceToBoundary([{ outer: polygon, holes: [] }], room.seed!)).toBeGreaterThan(1)
  })

  test('separators split faces and contribute to deterministic identity', () => {
    const source = scene()
    const separator = SeparatorNode.parse({
      id: 'separator_middle',
      parentId: 'level_main',
      start: [5, 0],
      end: [5, 10],
    })
    add(source, separator)
    const result = migrateRoomZones(source)
    expect(result.createdZoneIds).toHaveLength(2)
    for (const room of zones(result.nodes))
      expect(room.boundarySeparatorIds).toEqual([separator.id])
    const renamed = { ...source, separator_other: { ...separator, id: 'separator_other' } }
    delete renamed[separator.id]
    expect(migrateRoomZones(renamed).createdZoneIds).not.toEqual(result.createdZoneIds)
    expect(JSON.stringify(migrateRoomZones(result.nodes).nodes)).toBe(JSON.stringify(result.nodes))
  })

  test('open loops and the exterior never generate rooms', () => {
    const source = scene()
    delete source.wall_outer_0
    expect(migrateRoomZones(source).createdZoneIds).toEqual([])
    expect(detectRoomFaces([])).toEqual([])
  })
})

describe('M6 ceiling room links', () => {
  test('links auto and matching height-less ceilings, preserves legacy flags and children, and is idempotent', () => {
    const source = scene()
    for (const [id, fields] of [
      ['ceiling_auto', { autoFromWalls: true, height: 8, children: ['item_light'] }],
      ['ceiling_absent', {}],
      ['ceiling_false', { autoFromWalls: false }],
      ['ceiling_explicit', { autoFromWalls: false, height: 2 }],
      ['ceiling_unmatched', { autoFromWalls: true, polygon: rectangle(30, 30) }],
    ] as const)
      add(source, { type: 'ceiling', id, parentId: 'level_main', polygon: rectangle(), ...fields })
    const rooms = migrateRoomZones(source)
    freeze(rooms.nodes)
    const result = migrateCeilingRoomLinks(rooms.nodes)
    expect(result.linkedCeilingIds).toEqual(['ceiling_auto', 'ceiling_absent', 'ceiling_false'])
    for (const id of result.linkedCeilingIds) {
      expect(result.nodes[id]).toEqual({
        ...(rooms.nodes[id] as object),
        zoneId: rooms.createdZoneIds[0],
        boundary: 'auto',
      })
    }
    expect(result.nodes.ceiling_explicit).toBe(rooms.nodes.ceiling_explicit)
    expect(result.nodes.ceiling_unmatched).toBe(rooms.nodes.ceiling_unmatched)
    const again = migrateCeilingRoomLinks(result.nodes)
    expect(again.nodes).toBe(result.nodes)
    expect(JSON.stringify(again.nodes)).toBe(JSON.stringify(result.nodes))
  })

  test('height-less ceilings need an actual face; matching a stale room zone is insufficient', () => {
    const source = scene()
    delete source.wall_outer_0
    add(
      source,
      ZoneNode.parse({
        id: 'zone_stale',
        name: 'Room',
        parentId: 'level_main',
        polygon: rectangle(),
        spaceRole: 'room',
        autoFromWalls: true,
      }),
    )
    add(
      source,
      CeilingNode.parse({ id: 'ceiling_stale', parentId: 'level_main', polygon: rectangle() }),
    )
    expect(migrateCeilingRoomLinks(source).nodes).toBe(source)
  })

  test('matches holes and same-level rooms with the same inclusive IoU threshold', () => {
    const source = scene()
    for (const wall of walls(rectangle(3, 3, 4, 4), 'inner')) add(source, wall)
    add(
      source,
      CeilingNode.parse({
        id: 'ceiling_ring',
        parentId: 'level_main',
        polygon: rectangle(),
        holes: [rectangle(3, 3, 4, 4)],
        autoFromWalls: true,
      }),
    )
    add(
      source,
      CeilingNode.parse({
        id: 'ceiling_filled',
        parentId: 'level_main',
        polygon: rectangle(),
        autoFromWalls: true,
      }),
    )
    add(
      source,
      CeilingNode.parse({
        id: 'ceiling_foreign',
        parentId: 'level_main',
        polygon: rectangle(30, 30),
        autoFromWalls: true,
      }),
    )
    source.zone_foreign = ZoneNode.parse({
      id: 'zone_foreign',
      name: 'Foreign',
      spaceRole: 'room',
      polygon: rectangle(30, 30),
      parentId: 'level_other',
    })
    const rooms = migrateRoomZones(source)
    const result = migrateCeilingRoomLinks(rooms.nodes)
    expect(result.linkedCeilingIds).toEqual(['ceiling_ring'])
    expect((result.nodes.ceiling_ring as any).zoneId).toBe(
      zones(rooms.nodes).find((zone) => zone.holes.length === 1)!.id,
    )
    for (const width of [9, 8.999]) {
      const plain = scene()
      // 2 m walls hide the missing strip, so only the IoU threshold decides the link.
      for (const node of Object.values(plain)) if (node.type === 'wall') node.thickness = 2
      add(
        plain,
        CeilingNode.parse({
          id: 'ceiling_threshold',
          parentId: 'level_main',
          polygon: rectangle(0, 0, width, 10),
          autoFromWalls: true,
        }),
      )
      expect(migrateCeilingRoomLinks(migrateRoomZones(plain).nodes).linkedCeilingIds.length).toBe(
        width === 9 ? 1 : 0,
      )
    }
  })

  test('rooms M3 migrates keep exactly the legacy ceilings: none where none was drawn', () => {
    const source = scene(rectangle(0, 0, 8, 4))
    add(
      source,
      WallNode.parse({ id: 'wall_divider', parentId: 'level_main', start: [4, 0], end: [4, 4] }),
    )
    add(
      source,
      CeilingNode.parse({
        id: 'ceiling_left',
        parentId: 'level_main',
        polygon: rectangle(0, 0, 4, 4),
        autoFromWalls: true,
      }),
    )
    const rooms = migrateRoomZones(source)
    freeze(rooms.nodes)
    const result = migrateCeilingRoomLinks(rooms.nodes)
    expect(result.linkedCeilingIds).toEqual(['ceiling_left'])
    const linked = (result.nodes.ceiling_left as CeilingNode).zoneId
    expect(result.ceilinglessZoneIds).toEqual(rooms.createdZoneIds.filter((id) => id !== linked))
    expect(result.nodes[linked!]).not.toHaveProperty('hasCeiling')
    for (const id of result.ceilinglessZoneIds)
      expect(result.nodes[id]).toMatchObject({ hasCeiling: false })
    const again = migrateCeilingRoomLinks(migrateRoomZones(result.nodes).nodes)
    expect(again.nodes).toBe(result.nodes)
  })

  test('a level of knee-high walls without legacy ceilings gets none', () => {
    const source = scene()
    for (const node of Object.values(source)) if (node.type === 'wall') node.height = 0.5
    const result = migrateCeilingRoomLinks(migrateRoomZones(source).nodes)
    expect(zones(result.nodes).map((zone) => zone.hasCeiling)).toEqual([false])
  })

  test('levels the kernel already reconciled and reloads keep their rooms ceiling intent', () => {
    const migrated = migrateRoomZones(scene())
    const zone = zones(migrated.nodes)[0]!
    const reconciled: Nodes = { ...migrated.nodes }
    add(
      reconciled,
      SlabNode.parse({
        id: 'slab_plate',
        parentId: 'level_main',
        polygon: rectangle(),
        boundary: 'auto',
        plateRole: 'base',
      }),
    )
    expect(migrateCeilingRoomLinks(reconciled).nodes).toBe(reconciled)
    // A reload: the level no longer carries M3's migration mark.
    const { legacyRoomMigrationPending: _pending, ...metadata } = (migrated.nodes.level_main as any)
      .metadata
    const reloaded = {
      ...migrated.nodes,
      level_main: { ...(migrated.nodes.level_main as any), metadata },
    }
    expect(migrateCeilingRoomLinks(reloaded).nodes).toBe(reloaded)
    expect(zone.hasCeiling).toBeUndefined()
  })

  test('a legacy ceiling drawn off its room face stays manual rather than visibly moving', () => {
    const source = scene()
    add(
      source,
      CeilingNode.parse({
        id: 'ceiling_overhang',
        parentId: 'level_main',
        polygon: rectangle(0, -0.5, 10, 10.5),
        autoFromWalls: true,
      }),
    )
    const rooms = migrateRoomZones(source)
    const result = migrateCeilingRoomLinks(rooms.nodes)
    expect(result.linkedCeilingIds).toEqual([])
    expect(result.nodes.ceiling_overhang).toBe(rooms.nodes.ceiling_overhang)
    expect(result.ceilinglessZoneIds).toEqual(rooms.createdZoneIds)
  })
})

test('adopts the clear inner faces of a 4×3 room with centred 0.2 m walls', () => {
  const source = scene(rectangle(0, 0, 4, 3))
  for (const wall of Object.values(source)) if (wall.type === 'wall') wall.thickness = 0.2
  add(
    source,
    ZoneNode.parse({
      id: 'zone_clear',
      parentId: 'level_main',
      name: 'Office',
      polygon: rectangle(0.1, 0.1, 3.8, 2.8),
    }),
  )
  const migrated = migrateRoomZones(source)
  expect(migrated.createdZoneIds).toEqual([])
  expect(migrated.adoptedZoneIds).toEqual(['zone_clear'])
  expect(zones(migrated.nodes)[0]!.polygon).toEqual(rectangle(0, 0, 4, 3))
  expect(JSON.stringify(migrateRoomZones(migrated.nodes).nodes)).toBe(
    JSON.stringify(migrated.nodes),
  )
})

describe('M3 adoption of hand-drawn zones', () => {
  test('a zone drawn to the outer wall faces is adopted', () => {
    const source = scene(rectangle(0, 0, 4, 3))
    for (const wall of Object.values(source)) if (wall.type === 'wall') wall.thickness = 0.2
    add(source, {
      id: 'zone_outer',
      type: 'zone',
      parentId: 'level_main',
      name: 'Study',
      polygon: rectangle(-0.3, -0.3, 4.6, 3.6),
    })
    const migrated = migrateRoomZones(source)
    expect(migrated.adoptedZoneIds).toEqual(['zone_outer'])
    expect(migrated.createdZoneIds).toEqual([])
  })

  test('a zone spanning a closet is the room it mostly covers; the closet gets the next room number', () => {
    const source = scene(rectangle(0, 0, 6, 4))
    for (const [id, start, end] of [
      ['wall_closet_side', [4, 0], [4, 2]],
      ['wall_closet_top', [4, 2], [6, 2]],
    ] as const)
      add(source, WallNode.parse({ id, parentId: 'level_main', start, end }))
    add(source, {
      id: 'zone_bedroom',
      type: 'zone',
      parentId: 'level_main',
      name: 'Bedroom',
      polygon: rectangle(0, 0, 6, 4),
    })
    const migrated = migrateRoomZones(source)
    expect(migrated.adoptedZoneIds).toEqual(['zone_bedroom'])
    expect(migrated.createdZoneIds).toHaveLength(1)
    const bedroom = migrated.nodes.zone_bedroom as ZoneNode
    expect(bedroom.name).toBe('Bedroom')
    expect(area([{ outer: bedroom.polygon, holes: bedroom.holes }])).toBeCloseTo(20)
    expect((migrated.nodes[migrated.createdZoneIds[0]!] as ZoneNode).name).toBe('Room 1')
  })

  test('an aggregate zone over several rooms stays a zone; its rooms are numbered past existing ones', () => {
    const source = scene(rectangle(0, 0, 9, 3))
    for (const x of [3, 6])
      add(
        source,
        WallNode.parse({
          id: `wall_split_${x}`,
          parentId: 'level_main',
          start: [x, 0],
          end: [x, 3],
        }),
      )
    const flat = ZoneNode.parse({
      id: 'zone_flat',
      parentId: 'level_main',
      name: 'Apartment',
      polygon: rectangle(0, 0, 9, 3),
    })
    add(source, flat)
    for (const [id, name] of [
      ['zone_legacy_label', 'Room 2'],
      ['zone_slab_like', 'Room 3 Slab'],
      ['zone_cleared', ''],
    ] as const)
      add(
        source,
        ZoneNode.parse({ id, parentId: 'level_main', name, polygon: rectangle(20, 20, 1, 1) }),
      )
    const migrated = migrateRoomZones(source)
    expect(migrated.nodes.zone_flat).toBe(flat)
    expect(migrated.createdZoneIds).toHaveLength(3)
    expect(
      migrated.createdZoneIds.map((id) => (migrated.nodes[id] as ZoneNode).name).sort(),
    ).toEqual(['Room 1', 'Room 3', 'Room 4'])
    expect((migrated.nodes.zone_cleared as ZoneNode).name).toBe('')
  })

  test('of two zones in one room the one covering more is adopted; the other stays untouched', () => {
    const source = scene()
    const dining = ZoneNode.parse({
      id: 'zone_a_dining',
      parentId: 'level_main',
      name: 'Dining',
      polygon: rectangle(0, 0, 6, 10),
    })
    add(source, dining)
    add(
      source,
      ZoneNode.parse({
        id: 'zone_b_kitchen',
        parentId: 'level_main',
        name: 'Kitchen',
        polygon: rectangle(0, 0, 8, 10),
      }),
    )
    const migrated = migrateRoomZones(source)
    expect(migrated.adoptedZoneIds).toEqual(['zone_b_kitchen'])
    expect(migrated.nodes[dining.id]).toBe(dining)
    expect(migrated.createdZoneIds).toEqual([])
  })
})

describe('existing rooms and ties across load paths', () => {
  test('a reload keeps an existing room whose face grew, never a replacement', () => {
    // Kitchen was adopted when a wall at x = 4 closed it; that wall is gone now.
    const source = scene(rectangle(0, 0, 10, 4))
    const kitchen = ZoneNode.parse({
      id: 'zone_kitchen',
      parentId: 'level_main',
      name: 'Kitchen',
      polygon: rectangle(0, 0, 4, 4),
      seed: [2, 2],
      spaceRole: 'room',
      autoFromWalls: true,
      boundaryWallIds: ['wall_outer_0', 'wall_outer_2', 'wall_outer_3', 'wall_gone'],
    })
    add(source, kitchen)
    const migrated = migrateRoomZones(source)
    expect(migrated.createdZoneIds).toEqual([])
    expect(migrated.nodes.zone_kitchen).toMatchObject({
      name: 'Kitchen',
      polygon: rectangle(0, 0, 10, 4),
    })
    const level = reconcileLevelStructure({
      levelId: 'level_main',
      nodes: migrated.nodes as Record<string, AnyNode>,
      mintId: (kind) => `${kind}_minted`,
    })
    expect(level.patches.filter((patch) => patch.op === 'delete')).toEqual([])
    expect(level.events.filter((event) => event.type === 'retired')).toEqual([])
  })

  test('a zone split evenly between two rooms adopts the same one on load and live', () => {
    const source = scene(rectangle(0, 0, 8, 4))
    add(
      source,
      WallNode.parse({ id: 'wall_middle', parentId: 'level_main', start: [4, 0], end: [4, 4] }),
    )
    add(
      source,
      ZoneNode.parse({
        id: 'zone_even',
        parentId: 'level_main',
        name: 'Even',
        polygon: rectangle(2, 0, 4, 4),
      }),
    )
    const loaded = migrateRoomZones(source).nodes.zone_even as ZoneNode
    const live = reconcileLevelStructure({
      levelId: 'level_main',
      nodes: source as Record<string, AnyNode>,
      mintId: (kind) => `${kind}_minted`,
    }).patches.find((patch) => patch.op === 'update' && patch.id === 'zone_even')
    expect(loaded.autoFromWalls).toBe(true)
    expect(live?.op === 'update' && live.data.polygon).toEqual(loaded.polygon)
  })
})

// Prod "Wawa House" (level 0): walls drawn a few centimetres short of their corners and
// twelve hand-drawn zones. Before this rule Living Room and Master Bedroom had no room,
// and Entrance and Bathroom got a duplicate "Room" beside them.
describe('hand-drawn zones in a production house', () => {
  const source = JSON.parse(
    readFileSync(new URL('./__fixtures__/project_hrY3qVVq16yo5Out.json', import.meta.url), 'utf8'),
  ) as Record<string, unknown>
  const load = (nodes: Record<string, unknown>) => {
    const vertical = migrateVerticalSceneNodes(
      healSceneNodes(normalizeLegacyStructure(nodes)).nodes,
    ).nodes
    const rooms = migrateRoomZones(vertical).nodes
    const plates = migrateFloorPlates(migrateCeilingRoomLinks(rooms).nodes).nodes
    const openings = ensureSceneOpenings(migrateSlabSlots(plates).nodes).nodes
    const walls = migrateWallFaceBands(migrateWallFaceKeys(openings).nodes).nodes
    return reconcileStructureOnLoad(walls, vertical).nodes as Record<string, AnyNode>
  }
  const first = load(source)
  const named = Object.values(source).filter((node: any) => node.type === 'zone') as ZoneNode[]

  test('every enclosed named zone becomes its room, keeping id and name', () => {
    for (const zone of named) {
      const after = first[zone.id] as ZoneNode
      expect(after?.name).toBe(zone.name)
      expect(after.spaceRole === 'room' && after.autoFromWalls).toBe(zone.name !== 'Swimming Pool')
    }
  })

  test('unnamed rooms are numbered, never "Room", and no face holds two rooms', () => {
    const rooms = zones(first).filter((zone) => zone.spaceRole === 'room' && zone.autoFromWalls)
    expect(rooms).toHaveLength(17)
    expect(rooms.filter((zone) => zone.name === 'Room')).toEqual([])
    expect(
      rooms
        .filter((zone) => !source[zone.id])
        .map((zone) => zone.name)
        .sort(),
    ).toEqual(['Room 1', 'Room 2', 'Room 3', 'Room 4', 'Room 5', 'Room 6'])
    const keys = rooms.map((zone) => [...zone.boundaryWallIds].sort().join('|'))
    expect(new Set(keys).size).toBe(keys.length)
  })

  test('the load is deterministic and a second load is a no-op', () => {
    expect(JSON.stringify(load(source))).toBe(JSON.stringify(first))
    expect(JSON.stringify(load(first))).toBe(JSON.stringify(first))
  })
})

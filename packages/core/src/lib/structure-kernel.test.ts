import { describe, expect, spyOn, test } from 'bun:test'
import clipping from 'polygon-clipping'
import type { AnyNode } from '../schema'
import {
  BuildingNode,
  CeilingNode,
  ItemNode,
  LevelNode,
  SeparatorNode,
  SlabNode,
  UnitNode,
  WallNode,
  ZoneNode,
} from '../schema'
import { clearLevelFootprintCaches } from './level-footprints'
import { area, containsPoint } from './polygon-boolean'
import {
  createLevelStructurePreview,
  type NodePatch,
  reconcileLevelStructure,
  type SceneNodes,
} from './structure-kernel'
import { deriveZoneQuantityReport } from './zone-quantities'

const levelId = 'level_kernel'
const ring: [number, number][] = [
  [0, 0],
  [8, 0],
  [8, 4],
  [0, 4],
]
function fixture() {
  const walls = ring.map((start, i) =>
    WallNode.parse({
      id: `wall_${i}`,
      parentId: levelId,
      start,
      end: ring[(i + 1) % 4],
      thickness: 0.2,
    }),
  )
  const level = LevelNode.parse({ id: levelId, children: walls.map((wall) => wall.id) })
  return Object.fromEntries([level, ...walls].map((node) => [node.id, node]))
}
function apply(nodes: SceneNodes, patches: NodePatch[]): Record<string, AnyNode> {
  const result = { ...nodes }
  for (const patch of patches) {
    if (patch.op === 'delete') delete result[patch.id]
    else if (patch.op === 'create') result[patch.node.id] = patch.node
    else {
      const node = { ...result[patch.id], ...patch.data } as AnyNode
      for (const key of Object.keys(patch.data))
        if (patch.data[key as keyof typeof patch.data] === undefined)
          delete (node as unknown as Record<string, unknown>)[key]
      result[patch.id] = node
    }
  }
  return result
}
function run(nodes: SceneNodes) {
  let count = 0
  const plan = reconcileLevelStructure({
    levelId,
    nodes,
    mintId: (kind) => {
      let id: string
      do {
        id = `${kind}_${String(++count).padStart(4, '0')}`
      } while (nodes[id])
      return id
    },
  })
  return { ...plan, nodes: apply(nodes, plan.patches) }
}
function zones(nodes: SceneNodes) {
  return Object.values(nodes).filter((node): node is ZoneNode => node.type === 'zone')
}
function ceilings(nodes: SceneNodes) {
  return Object.values(nodes).filter((node): node is CeilingNode => node.type === 'ceiling')
}
function split(nodes: SceneNodes, x = 2, separator = false) {
  const node = (separator ? SeparatorNode : WallNode).parse({
    id: separator ? 'separator_divider' : 'wall_divider',
    parentId: levelId,
    start: [x, 0],
    end: [x, 4],
  })
  return run({ ...nodes, [node.id]: node })
}
function assertIdempotent(nodes: SceneNodes) {
  expect(run(nodes).patches).toEqual([])
}

describe('structure kernel', () => {
  test('close creates a room, clear ceiling and parent links; deterministic and idempotent', () => {
    const nodes = fixture()
    const bytes = JSON.stringify(nodes)
    const result = run(nodes)
    expect(run(Object.fromEntries(Object.entries(nodes).reverse()))).toEqual(result)
    expect(JSON.stringify(nodes)).toBe(bytes)
    expect(zones(result.nodes)).toHaveLength(1)
    const zone = zones(result.nodes)[0]!
    expect(zone).toMatchObject({ spaceRole: 'room', enclosureStatus: 'enclosed', seed: [4, 2] })
    const ceiling = ceilings(result.nodes)[0]!
    expect(ceiling).toMatchObject({ zoneId: zone.id, boundary: 'auto', autoFromWalls: true })
    expect('height' in ceiling).toBe(false)
    expect(area([{ outer: ceiling.polygon, holes: ceiling.holes }])).toBeCloseTo(7.8 * 3.8)
    expect((result.nodes[levelId] as LevelNode).children).toEqual(
      expect.arrayContaining([zone.id, ceiling.id]),
    )
    assertIdempotent(result.nodes)
  })
  test('split preserves seed identity, inherits intent, and merge keeps the largest overlap', () => {
    const initial = run(fixture()).nodes
    const zone = zones(initial)[0]!
    initial[zone.id] = {
      ...zone,
      name: 'Kitchen',
      seed: [1, 2],
      floor: { elevation: 0.3, finish: 'oak' },
      wallMaterial: 'white',
      hasFloor: false,
    }
    const divided = split(initial)
    expect(zones(divided.nodes)).toHaveLength(2)
    expect(divided.nodes[zone.id]).toMatchObject({ name: 'Kitchen', seed: [1, 2] })
    for (const room of zones(divided.nodes))
      expect(room).toMatchObject({
        floor: { elevation: 0.3, finish: 'oak' },
        wallMaterial: 'white',
        hasFloor: false,
      })
    const { wall_divider: _, ...merged } = divided.nodes
    const result = run(merged)
    const larger = zones(divided.nodes).find((room) => room.id !== zone.id)!
    expect(zones(result.nodes).map((room) => room.id)).toEqual([larger.id])
    expect(result.events).toContainEqual({
      type: 'retired',
      zoneId: zone.id,
      survivorId: larger.id,
    })
    assertIdempotent(divided.nodes)
    assertIdempotent(result.nodes)
  })
  test('open retains room data, removes its ceiling and quantities; reclose re-adopts', () => {
    const initial = run(fixture()).nodes
    const zone = zones(initial)[0]!
    initial[zone.id] = { ...zone, name: 'Office', roomNumber: '42', floor: { finish: 'oak' } }
    const { wall_3: closing, ...open } = initial
    const opened = run(open)
    expect(opened.nodes[zone.id]).toMatchObject({
      name: 'Office',
      roomNumber: '42',
      floor: { finish: 'oak' },
      enclosureStatus: 'open',
      polygon: zone.polygon,
    })
    expect(ceilings(opened.nodes)).toEqual([])
    const report = deriveZoneQuantityReport(opened.nodes[zone.id] as ZoneNode, opened.nodes)
    expect(report.floorSurface.status).toBe('unavailable')
    expect(report.wallSurface.status).toBe('unavailable')
    expect(report.volume.status).toBe('unavailable')
    const reclosed = run({ ...opened.nodes, [closing!.id]: closing! })
    expect(zones(reclosed.nodes).map((room) => room.id)).toEqual([zone.id])
    expect(reclosed.events).toContainEqual({ type: 'reopened', zoneId: zone.id })
    assertIdempotent(opened.nodes)
    assertIdempotent(reclosed.nodes)
  })
  test('nested loop creates an outer hole and a separate inner room', () => {
    const nodes = fixture()
    const hole: [number, number][] = [
      [3, 1],
      [5, 1],
      [5, 3],
      [3, 3],
    ]
    for (let i = 0; i < 4; i++) {
      const wall = WallNode.parse({
        id: `wall_inner_${i}`,
        parentId: levelId,
        start: hole[i],
        end: hole[(i + 1) % 4],
        thickness: 0.2,
      })
      nodes[wall.id] = wall
    }
    const result = run(nodes)
    expect(zones(result.nodes)).toHaveLength(2)
    const outer = zones(result.nodes).find((room) => room.holes.length)!
    expect(area([{ outer: outer.polygon, holes: outer.holes }])).toBe(28)
    expect(containsPoint([{ outer: outer.polygon, holes: outer.holes }], outer.seed!)).toBe(true)
    expect(
      ceilings(result.nodes).find((ceiling) => ceiling.zoneId === outer.id)?.holes,
    ).toHaveLength(1)
    assertIdempotent(result.nodes)
  })
  test('separator splits zones and ceilings', () => {
    const result = split(run(fixture()).nodes, 2, true)
    expect(zones(result.nodes)).toHaveLength(2)
    expect(ceilings(result.nodes)).toHaveLength(2)
    for (const zone of zones(result.nodes))
      expect(zone.boundarySeparatorIds).toEqual(['separator_divider'])
    assertIdempotent(result.nodes)
  })
  test('generic adoption uses IoU >= 0.9 including clear footprints; unrelated manual zones stay unchanged', () => {
    for (const polygon of [
      ring,
      [
        [0.1, 0.1],
        [7.9, 0.1],
        [7.9, 3.9],
        [0.1, 3.9],
      ] as [number, number][],
    ]) {
      const generic = ZoneNode.parse({
        id: 'zone_generic',
        parentId: levelId,
        name: 'Kitchen',
        polygon,
      })
      const unrelated = ZoneNode.parse({
        id: 'zone_garden',
        parentId: levelId,
        name: 'Garden',
        polygon: [
          [20, 20],
          [24, 20],
          [24, 24],
          [20, 24],
        ],
      })
      const result = run({ ...fixture(), [generic.id]: generic, [unrelated.id]: unrelated })
      expect(result.nodes[generic.id]).toMatchObject({
        spaceRole: 'room',
        autoFromWalls: true,
        name: 'Kitchen',
      })
      expect(result.nodes[unrelated.id]).toBe(unrelated)
      expect(result.events).toContainEqual({ type: 'adopted', zoneId: generic.id })
    }
  })
  test('hasCeiling false deletes owned ceiling and never regenerates; manual ceiling stays untouched', () => {
    const initial = run(fixture()).nodes
    const zone = zones(initial)[0]!
    const manual = CeilingNode.parse({
      id: 'ceiling_manual',
      parentId: levelId,
      zoneId: zone.id,
      polygon: ring,
      height: 2.1,
      autoFromWalls: true,
    })
    const result = run({
      ...initial,
      [zone.id]: { ...zone, hasCeiling: false },
      [manual.id]: manual,
    })
    expect(ceilings(result.nodes)).toEqual([manual])
    expect(result.nodes[manual.id]).toBe(manual)
    assertIdempotent(result.nodes)
    const divided = split(result.nodes)
    expect(zones(divided.nodes).every((room) => room.hasCeiling === false)).toBe(true)
    expect(ceilings(divided.nodes)).toEqual([manual])
  })
  test('children partition by position and union on merge, boundary child stays on survivor', () => {
    const initial = run(fixture()).nodes
    const zone = zones(initial)[0]!
    initial[zone.id] = { ...zone, seed: [1, 2] }
    const ceiling = ceilings(initial)[0]!
    const items = [
      [1, 2],
      [6, 2],
      [2, 2],
    ].map(([x, z], i) =>
      ItemNode.parse({
        id: `item_${i}`,
        parentId: ceiling.id,
        position: [x, 0, z],
        asset: {
          id: 'light',
          name: 'Light',
          category: 'lighting',
          thumbnail: '',
          src: '/light.glb',
        },
      }),
    )
    for (const item of items) initial[item.id] = item
    initial[ceiling.id] = { ...ceiling, children: items.map((item) => item.id) }
    const divided = split(initial)
    const left = ceilings(divided.nodes).find((node) => node.zoneId === zone.id)!
    expect(left.children).toEqual(['item_0', 'item_2'])
    const right = ceilings(divided.nodes).find((node) => node.id !== left.id)!
    expect(right.children).toEqual(['item_1'])
    expect(divided.nodes.item_1?.parentId).toBe(right.id)
    const { wall_divider: _, ...merged } = divided.nodes
    const result = run(merged)
    expect(ceilings(result.nodes)).toHaveLength(1)
    expect(ceilings(result.nodes)[0]!.children).toEqual(items.map((item) => item.id))
    for (const item of items) expect(result.nodes[item.id]?.parentId).toBe(right.id)
    assertIdempotent(result.nodes)
  })
  test('wall sides classify exterior, partition, and two rooms on the same face', () => {
    const result = split(run(fixture()).nodes)
    expect(result.nodes.wall_0).toMatchObject({ frontSide: 'interior', backSide: 'exterior' })
    expect(result.nodes.wall_divider).toMatchObject({ frontSide: 'interior', backSide: 'interior' })
    expect(
      result.snapshot.rooms
        .flatMap((room) => room.spans)
        .filter((span) => span.boundaryId === 'wall_0' && span.face === 'a'),
    ).toHaveLength(2)
    const nodes = fixture()
    nodes.wall_0 = { ...(nodes.wall_0 as WallNode), start: [8, 0], end: [0, 0] }
    expect(run(nodes).nodes.wall_0).toMatchObject({ frontSide: 'exterior', backSide: 'interior' })
  })
  test('overlap fallback moves a lost seed; equal overlap chooses the first canonical face', () => {
    const nodes = run(fixture()).nodes
    const zone = zones(nodes)[0]!
    nodes[zone.id] = { ...zone, seed: [100, 100] }
    const result = split(nodes, 4)
    const kept = result.nodes[zone.id] as ZoneNode
    expect(containsPoint([{ outer: kept.polygon, holes: kept.holes }], kept.seed!)).toBe(true)
    expect(kept.polygon).toContainEqual([0, 0])
    assertIdempotent(result.nodes)
  })
  test('a drawn zone covering most of a room is adopted; an overlapping loser is never deleted', () => {
    const dining = ZoneNode.parse({
      id: 'zone_a_dining',
      parentId: levelId,
      name: 'Dining',
      polygon: [
        [0, 0],
        [5, 0],
        [5, 4],
        [0, 4],
      ],
    })
    const kitchen = ZoneNode.parse({
      id: 'zone_b_kitchen',
      parentId: levelId,
      name: 'Kitchen',
      polygon: [
        [-0.3, -0.3],
        [7, -0.3],
        [7, 4.3],
        [-0.3, 4.3],
      ],
    })
    const result = run({ ...fixture(), [dining.id]: dining, [kitchen.id]: kitchen })
    expect(result.nodes[kitchen.id]).toMatchObject({ spaceRole: 'room', name: 'Kitchen' })
    expect(result.nodes[dining.id]).toBe(dining)
    expect(zones(result.nodes)).toHaveLength(2)
    assertIdempotent(result.nodes)
  })
  test('a drawn zone spanning a partition belongs to the room holding most of it', () => {
    const zone = ZoneNode.parse({
      id: 'zone_open',
      parentId: levelId,
      name: 'Living',
      polygon: ring,
    })
    const result = split({ ...fixture(), [zone.id]: zone }, 5)
    const living = result.nodes[zone.id] as ZoneNode
    expect(living).toMatchObject({ spaceRole: 'room', autoFromWalls: true, name: 'Living' })
    expect(area([{ outer: living.polygon, holes: living.holes }])).toBeCloseTo(20)
    expect(zones(result.nodes)).toHaveLength(2)
    assertIdempotent(result.nodes)
  })
  test('rooms the kernel creates are numbered; existing and cleared names are never touched', () => {
    const closed = run(fixture()).nodes
    const first = zones(closed)[0]!
    expect(first.name).toBe('Room 1')
    const cleared = { ...closed, [first.id]: { ...first, name: '' } } as SceneNodes
    assertIdempotent(cleared)
    const divided = split(cleared, 4)
    const names = zones(divided.nodes)
      .map((zone) => zone.name)
      .sort()
    // The seed side keeps its cleared name; the new side takes the lowest free number.
    expect(names).toEqual(['', 'Room 1'])
    const kitchen = split({ ...closed, [first.id]: { ...first, name: 'Kitchen' } } as SceneNodes, 4)
    expect(
      zones(kitchen.nodes)
        .map((zone) => zone.name)
        .sort(),
    ).toEqual(['Kitchen', 'Room 1'])
  })
  test('generic auto zones still need the adoption threshold', () => {
    const generic = ZoneNode.parse({
      id: 'zone_generic_auto',
      name: 'Analysis',
      parentId: levelId,
      polygon: [
        [0, 0],
        [2, 0],
        [2, 2],
        [0, 2],
      ],
      seed: [1, 1],
      autoFromWalls: true,
    })
    const result = run({ ...fixture(), [generic.id]: generic })
    expect(result.nodes[generic.id]).toBe(generic)
    expect(zones(result.nodes)).toHaveLength(2)
    assertIdempotent(result.nodes)
  })
  test('merge keeps the bedroom over a smaller closet; a unit containing only the closet follows the survivor', () => {
    const nodes = fixture()
    const left = ZoneNode.parse({
      id: 'zone_z_old',
      parentId: levelId,
      name: 'Bedroom',
      floor: { finish: 'oak' },
      wallMaterial: 'white',
      polygon: [
        [2, 0],
        [8, 0],
        [8, 4],
        [2, 4],
      ],
      autoFromWalls: true,
      spaceRole: 'room',
      seed: [6, 2],
    })
    const right = ZoneNode.parse({
      ...left,
      id: 'zone_a_old',
      name: 'Closet',
      floor: { finish: 'tile' },
      wallMaterial: 'blue',
      polygon: [
        [0, 0],
        [2, 0],
        [2, 4],
        [0, 4],
      ],
      seed: [1, 2],
    })
    const building = BuildingNode.parse({ id: 'building_test', children: [levelId, 'unit_test'] })
    nodes[building.id] = building
    nodes[levelId] = { ...nodes[levelId], parentId: building.id } as LevelNode
    const unit = UnitNode.parse({ id: 'unit_test', parentId: building.id, members: [right.id] })
    const result = run({ ...nodes, [left.id]: left, [right.id]: right, [unit.id]: unit })
    expect(zones(result.nodes).map((zone) => zone.id)).toEqual([left.id])
    expect(result.nodes[left.id]).toMatchObject({
      name: 'Bedroom',
      seed: [6, 2],
      floor: { finish: 'oak' },
      wallMaterial: 'white',
    })
    expect(result.nodes[unit.id]).toMatchObject({ members: [left.id] })
    assertIdempotent(result.nodes)
  })
  test('unlinked auto ceiling adopts a clear polygon and retains materials and authored holes on split', () => {
    const initial = run(fixture()).nodes
    const zone = zones(initial)[0]!
    const ceiling = ceilings(initial)[0]!
    initial[zone.id] = {
      ...zone,
      seed: [1, 2],
      floor: { regions: [{ id: 'region_floor', finish: 'oak', polygon: ring }] },
      wallOverrides: [{ wallId: 'wall_0', face: 'a', finish: 'paint' }],
    }
    initial[ceiling.id] = {
      ...ceiling,
      zoneId: undefined,
      materialPreset: 'plaster',
      holes: [
        [
          [0.5, 0.5],
          [1, 0.5],
          [1, 1],
          [0.5, 1],
        ],
      ],
      holeMetadata: [{ source: 'manual' }],
    }
    const linked = run(initial)
    expect(ceilings(linked.nodes)).toHaveLength(1)
    expect(ceilings(linked.nodes)[0]!.id).toBe(ceiling.id)
    const divided = split(linked.nodes)
    for (const host of ceilings(divided.nodes)) expect(host.materialPreset).toBe('plaster')
    expect(ceilings(divided.nodes).find((host) => host.zoneId === zone.id)!.holes).toHaveLength(1)
    expect(
      zones(divided.nodes).reduce(
        (sum, room) =>
          sum +
          area((room.floor?.regions ?? []).map((region) => ({ outer: region.polygon, holes: [] }))),
        0,
      ),
    ).toBe(32)
    for (const room of zones(divided.nodes))
      expect(room.wallOverrides).toEqual([{ wallId: 'wall_0', face: 'a', finish: 'paint' }])
    assertIdempotent(divided.nodes)
  })
  test('zone and ceiling previews change polygons without mutating the scene', () => {
    const nodes = run(fixture()).nodes
    const bytes = JSON.stringify(nodes)
    const walls = Object.values(nodes)
      .filter((node): node is WallNode => node.type === 'wall')
      .map((wall) => ({
        ...wall,
        start: [wall.start[0] * 2, wall.start[1]] as [number, number],
        end: [wall.end[0] * 2, wall.end[1]] as [number, number],
      }))
    const updates = createLevelStructurePreview(levelId, nodes)(walls)
    expect(
      updates.some((patch) => nodes[patch.id]?.type === 'zone' && 'polygon' in patch.data),
    ).toBe(true)
    expect(
      updates.some((patch) => nodes[patch.id]?.type === 'ceiling' && 'polygon' in patch.data),
    ).toBe(true)
    expect(JSON.stringify(nodes)).toBe(bytes)
  })
  test('equal merge overlap breaks ties by lowest id independent of node order', () => {
    const nodes = fixture()
    for (const [id, x] of [
      ['zone_z', 0],
      ['zone_a', 4],
    ] as const) {
      nodes[id] = ZoneNode.parse({
        id,
        name: id,
        parentId: levelId,
        polygon: [
          [x, 0],
          [x + 4, 0],
          [x + 4, 4],
          [x, 4],
        ],
        seed: [x + 2, 2],
        autoFromWalls: true,
        spaceRole: 'room',
      })
    }
    expect(zones(run(nodes).nodes).map((zone) => zone.id)).toEqual(['zone_a'])
    expect(run(Object.fromEntries(Object.entries(nodes).reverse()))).toEqual(run(nodes))
  })
  test('explicit auto ceiling height and material survive a wall move', () => {
    const nodes = run(fixture()).nodes
    const ceiling = ceilings(nodes)[0]!
    nodes[ceiling.id] = { ...ceiling, height: 2.1, materialPreset: 'plaster' }
    for (const node of Object.values(nodes)) {
      if (node.type === 'wall')
        nodes[node.id] = {
          ...node,
          start: [node.start[0] * 1.2, node.start[1]],
          end: [node.end[0] * 1.2, node.end[1]],
        }
    }
    const result = run(nodes)
    expect(result.nodes[ceiling.id]).toMatchObject({
      height: 2.1,
      materialPreset: 'plaster',
      boundary: 'auto',
    })
    expect((result.nodes[ceiling.id] as CeilingNode).polygon).not.toEqual(ceiling.polygon)
    assertIdempotent(result.nodes)
  })
  test('all ceiling boundaries suppress minting at 60 percent clear-face coverage, including holes', () => {
    for (const autoFromWalls of [false, true]) {
      for (const coverage of [0.59, 0.6, 0.61]) {
        const manual = CeilingNode.parse({
          id: 'ceiling_manual',
          parentId: levelId,
          autoFromWalls,
          polygon: [
            [0.1, 0.1],
            [7.9, 0.1],
            [7.9, 3.9],
            [0.1, 3.9],
          ],
          holes: [
            [
              [0.1, 0.1],
              [0.1 + 7.8 * (1 - coverage), 0.1],
              [0.1 + 7.8 * (1 - coverage), 3.9],
              [0.1, 3.9],
            ],
          ],
        })
        const result = run({ ...fixture(), [manual.id]: manual })
        expect(ceilings(result.nodes)).toHaveLength(coverage >= 0.6 ? 1 : 2)
        expect(result.nodes[manual.id]).toBe(manual)
        assertIdempotent(result.nodes)
      }
    }
  })
  test('explicit manual and auto heights clamp downward as covering slabs change, never upward', () => {
    const nodes = run(fixture()).nodes
    const auto = ceilings(nodes)[0]!
    const manual = CeilingNode.parse({
      id: 'ceiling_manual',
      parentId: levelId,
      polygon: [
        [20, 0],
        [24, 0],
        [24, 4],
        [20, 4],
      ],
      height: 2.4,
    })
    const slab = SlabNode.parse({
      id: 'slab_above',
      parentId: 'level_above',
      polygon: [
        [-1, -1],
        [25, -1],
        [25, 5],
        [-1, 5],
      ],
      elevation: 0,
      thickness: 0.5,
    })
    const above = LevelNode.parse({ id: 'level_above', level: 1, children: [slab.id] })
    nodes[auto.id] = { ...auto, height: 2.4 }
    nodes[manual.id] = manual
    nodes[slab.id] = slab
    nodes[above.id] = above
    const result = run(nodes)
    for (const id of [auto.id, manual.id])
      expect((result.nodes[id] as CeilingNode).height).toBeCloseTo(1.99)
    result.nodes[slab.id] = { ...slab, thickness: 0.1 }
    const raised = run(result.nodes)
    for (const id of [auto.id, manual.id])
      expect((raised.nodes[id] as CeilingNode).height).toBeCloseTo(1.99)
    assertIdempotent(raised.nodes)
  })

  test('a reusable preview never enumerates the source scene after drag start and resets removed walls', () => {
    const nodes = run(fixture()).nodes
    let scans = 0
    const scene = new Proxy(nodes, {
      ownKeys(target) {
        scans++
        return Reflect.ownKeys(target)
      },
    })
    const preview = createLevelStructurePreview(levelId, scene)
    expect(scans).toBe(1)
    const walls = Object.values(nodes).filter((node): node is WallNode => node.type === 'wall')
    const divider = WallNode.parse({
      id: 'wall_preview_divider',
      parentId: levelId,
      start: [2, 0],
      end: [2, 4],
    })
    expect(
      preview([...walls, divider]).some(
        (patch) => nodes[patch.id]?.type === 'zone' && 'polygon' in patch.data,
      ),
    ).toBe(true)
    expect(preview(walls)).toEqual([])
    expect(scans).toBe(1)
    assertIdempotent(nodes)
  })
  test('an unlinked auto ceiling covering the face is adopted without minting a duplicate', () => {
    const orphan = CeilingNode.parse({
      id: 'ceiling_orphan',
      parentId: levelId,
      boundary: 'auto',
      polygon: [
        [-2, -2],
        [10, -2],
        [10, 6],
        [-2, 6],
      ],
      height: 2.1,
    })
    const result = run({ ...fixture(), [orphan.id]: orphan })
    expect(ceilings(result.nodes).map((ceiling) => ceiling.id)).toEqual([orphan.id])
    expect(
      result.patches.some((patch) => patch.op === 'create' && patch.node.type === 'ceiling'),
    ).toBe(false)
    expect(result.nodes[orphan.id]).toMatchObject({
      height: 2.1,
      zoneId: zones(result.nodes)[0]!.id,
    })
    assertIdempotent(result.nodes)
  })
  test('re-adopting a ceiling after zone deletion preserves its hosted child links', () => {
    const nodes = run(fixture()).nodes
    const zone = zones(nodes)[0]!
    const ceiling = ceilings(nodes)[0]!
    const item = ItemNode.parse({
      id: 'item_hosted',
      parentId: ceiling.id,
      position: [1, 0, 1],
      asset: { id: 'light', name: 'Light', category: 'lighting', thumbnail: '', src: '/light.glb' },
    })
    nodes[item.id] = item
    nodes[ceiling.id] = { ...ceiling, children: [item.id] }
    delete nodes[zone.id]
    const result = run(nodes)
    expect(ceilings(result.nodes)).toHaveLength(1)
    expect(result.nodes[ceiling.id]).toMatchObject({
      zoneId: zones(result.nodes)[0]!.id,
      children: [item.id],
    })
    expect(result.nodes[item.id]?.parentId).toBe(ceiling.id)
    assertIdempotent(result.nodes)
  })
})

function plates(nodes: SceneNodes) {
  return Object.values(nodes).filter(
    (node): node is SlabNode => node.type === 'slab' && node.boundary === 'auto',
  )
}

test.each([
  false,
  true,
])('one full-footprint plate survives partition add/remove (separator=%s)', (separator) => {
  const initial = run(fixture()).nodes
  const plate = plates(initial)[0]!
  expect(plate.polygon).toContainEqual([-0.1, -0.1])
  const divided = split(initial, 2, separator).nodes
  expect(plates(divided)).toHaveLength(1)
  expect(plates(divided)[0]).toMatchObject({
    id: plate.id,
    zoneIds: zones(divided)
      .map((zone) => zone.id)
      .sort(),
  })
  delete divided[separator ? 'separator_divider' : 'wall_divider']
  const merged = run(divided).nodes
  expect(plates(merged).map((node) => node.id)).toEqual([plate.id])
  assertIdempotent(merged)
})

describe('ceiling outline', () => {
  function divided(divider: Partial<WallNode>) {
    const nodes = fixture()
    const wall = WallNode.parse({
      id: 'wall_divider',
      parentId: levelId,
      start: [4, 0],
      end: [4, 4],
      thickness: 0.2,
      ...divider,
    })
    ;(nodes[levelId] as LevelNode).children.push(wall.id)
    nodes[wall.id] = wall
    return run(nodes).nodes
  }
  const reach = (nodes: SceneNodes) =>
    ceilings(nodes)
      .map((ceiling) => ceiling.polygon.map(([x]) => x))
      .map((xs) => [Math.min(...xs), Math.max(...xs)])
      .sort((a, b) => a[0]! - b[0]!)

  test('stops at the faces of walls that reach it', () => {
    const nodes = divided({})
    expect(reach(nodes)).toEqual([
      [0.1, 3.9],
      [4.1, 7.9],
    ])
    assertIdempotent(nodes)
  })

  test('spans a half wall to its reference line instead of leaving a slot above it', () => {
    const nodes = divided({ height: 1 })
    expect(reach(nodes)).toEqual([
      [0.1, 4],
      [4, 7.9],
    ])
    assertIdempotent(nodes)
  })

  test('a room pinched in two by its walls keeps both parts and reloads without swapping ids', () => {
    // Two 3×4 rooms joined by a 0.1 m neck that 0.2 m walls close entirely.
    const outline: [number, number][] = [
      [0, 0],
      [3, 0],
      [3, 1.95],
      [5, 1.95],
      [5, 0],
      [8, 0],
      [8, 4],
      [5, 4],
      [5, 2.05],
      [3, 2.05],
      [3, 4],
      [0, 4],
    ]
    const walls = outline.map((start, i) =>
      WallNode.parse({
        id: `wall_neck_${String(i).padStart(2, '0')}`,
        parentId: levelId,
        start,
        end: outline[(i + 1) % outline.length],
        thickness: 0.2,
      }),
    )
    const level = LevelNode.parse({ id: levelId, children: walls.map((wall) => wall.id) })
    const result = run(Object.fromEntries([level, ...walls].map((node) => [node.id, node]))).nodes
    expect(zones(result)).toHaveLength(1)
    const parts = ceilings(result)
    expect(parts).toHaveLength(2)
    for (const part of parts)
      expect(area([{ outer: part.polygon, holes: part.holes }])).toBeCloseTo(2.8 * 3.8, 1)
    assertIdempotent(result)
  })
})

test('elevation splits plates; retirement remaps both support and deck references', () => {
  const initial = split(run(fixture()).nodes).nodes
  const zone = zones(initial)[0]!
  const original = plates(initial)[0]!
  initial[zone.id] = { ...zone, floor: { elevation: 0.4 } }
  const raised = run(initial).nodes
  expect(plates(raised)).toHaveLength(2)
  const high = plates(raised).find((plate) => plate.elevation === 0.4)!
  expect(high.id).not.toBe(original.id)
  const wall = raised.wall_0 as WallNode
  raised.wall_0 = { ...wall, supportSlabId: high.id }
  raised.stair_ref = {
    id: 'stair_ref',
    type: 'stair',
    parentId: 'level_elsewhere',
    deckSlabId: high.id,
  } as AnyNode
  raised[zone.id] = { ...raised[zone.id], floor: { elevation: 0.05 } } as ZoneNode
  const merged = run(raised).nodes
  expect(plates(merged).map((plate) => plate.id)).toEqual([original.id])
  expect(merged[high.id]).toBeUndefined()
  expect(merged.wall_0).toMatchObject({ supportSlabId: original.id })
  expect((merged.stair_ref as { deckSlabId?: string }).deckSlabId).toBeUndefined()
  assertIdempotent(merged)
})

test('a floorless inner room leaves a courtyard hole with walls supported', () => {
  const nodes = fixture()
  const hole: [number, number][] = [
    [3, 1],
    [5, 1],
    [5, 3],
    [3, 3],
  ]
  hole.forEach((start, i) => {
    const wall = WallNode.parse({
      id: `wall_void_${i}`,
      parentId: levelId,
      start,
      end: hole[(i + 1) % 4],
      thickness: 0.2,
    })
    nodes[wall.id] = wall
  })
  const initial = run(nodes).nodes
  const inner = zones(initial).find((zone) => !zone.holes.length)!
  initial[inner.id] = { ...inner, hasFloor: false }
  const result = run(initial).nodes
  expect(plates(result)).toHaveLength(1)
  const plate = plates(result)[0]!
  expect(plate.holes).toHaveLength(1)
  expect(containsPoint([{ outer: plate.polygon, holes: plate.holes }], [4, 2])).toBe(false)
  expect(containsPoint([{ outer: plate.polygon, holes: plate.holes }], [3, 2])).toBe(true)
  assertIdempotent(result)
})

test('manual coverage never elects room floor ownership at runtime', () => {
  for (const coverage of [0.59, 0.6, 0.61]) {
    const manual = SlabNode.parse({
      id: 'slab_manual',
      parentId: levelId,
      polygon: [
        [0, 0],
        [8 * coverage, 0],
        [8 * coverage, 4],
        [0, 4],
      ],
    })
    const result = run({ ...fixture(), [manual.id]: manual }).nodes
    expect(plates(result)).toHaveLength(1)
    expect(result[manual.id]).toBe(manual)
    assertIdempotent(result)
  }
})

test('manual and stair holes survive a plate merge with parallel metadata', () => {
  const initial = split(run(fixture()).nodes).nodes
  const plate = plates(initial)[0]!
  initial[plate.id] = {
    ...plate,
    holes: [
      [
        [1, 1],
        [2, 1],
        [2, 2],
        [1, 2],
      ],
    ],
    holeMetadata: [{ source: 'stair', stairId: 'stair_test' }],
  }
  delete initial.wall_divider
  const result = run(initial).nodes
  expect(plates(result)[0]).toMatchObject({
    holes: (initial[plate.id] as SlabNode).holes,
    holeMetadata: [{ source: 'stair', stairId: 'stair_test' }],
  })
  assertIdempotent(result)
})

test('kernel does not adopt legacy elevation intent; migration owns that conversion', () => {
  const initial = fixture()
  const legacy = SlabNode.parse({
    id: 'slab_legacy',
    parentId: levelId,
    polygon: ring,
    autoFromWalls: true,
    elevation: 0.4,
  })
  initial[legacy.id] = legacy
  const adopted = run(initial).nodes
  expect(plates(adopted)).toHaveLength(1)
  expect(plates(adopted)[0]).toMatchObject({
    id: legacy.id,
    boundary: 'auto',
    elevation: 0.05,
  })
  expect(zones(adopted)[0]!.floor?.elevation).toBeUndefined()
  const { wall_0: _, ...opened } = adopted
  expect(plates(run(opened).nodes)).toHaveLength(0)
  const { wall_0: _legacyWall, ...legacyOpened } = initial
  expect(plates(run(legacyOpened).nodes)).toHaveLength(0)
  const cover = SlabNode.parse({ id: 'slab_legacy_cover', parentId: levelId, polygon: ring })
  const zone = zones(adopted)[0]!
  const suppressed = run({
    ...adopted,
    [zone.id]: { ...zone, floor: { ...zone.floor, sourceSlabId: cover.id } },
    [cover.id]: cover,
  }).nodes
  expect(suppressed[legacy.id]).toBeUndefined()
  expect(suppressed[cover.id]).toBe(cover)
  assertIdempotent(adopted)
})

test('a failing plate union leaves existing level construction unchanged and warns once', () => {
  const original = run(fixture()).nodes
  clearLevelFootprintCaches()
  const warning = spyOn(console, 'warn').mockImplementation(() => {})
  const clip = spyOn(clipping, 'union').mockImplementation(() => {
    throw new Error('fixture union failure')
  })
  try {
    expect(run(original).patches).toEqual([])
    expect(run(original).patches).toEqual([])
    expect(
      warning.mock.calls.filter(
        ([message]) => message === '[floor plates] Keeping existing level construction',
      ),
    ).toHaveLength(1)
  } finally {
    clip.mockRestore()
    warning.mockRestore()
  }
})

test('connected rooms without authored elevation share the highest boundary base', () => {
  const nodes = fixture()
  nodes.wall_1 = { ...nodes.wall_1, supportOffset: 0.4 } as WallNode
  const result = split(nodes, 4).nodes
  expect(plates(result)).toHaveLength(1)
  expect(plates(result)[0]!.elevation).toBe(0.45)
  expect(plates(result)[0]!.zoneIds).toHaveLength(2)
  expect(zones(result).every((zone) => zone.floor?.elevation === undefined)).toBe(true)
  assertIdempotent(result)
})

test('a reconciliation without retired plates never spreads unrelated scene nodes', () => {
  const initial = run(fixture()).nodes
  let reads = 0
  const unrelated = {
    id: 'item_elsewhere',
    type: 'item',
    parentId: 'level_other',
    get metadata() {
      reads++
      return {}
    },
  } as AnyNode
  const result = run({ ...initial, [unrelated.id]: unrelated })
  expect(reads).toBe(0)
  expect(result.patches).toEqual([])
  expect(result.nodes[unrelated.id]).toBe(unrelated)
})

test('a wall move that bridges a junction keeps the room and adds the bridge to its boundary', () => {
  const initial = run(fixture()).nodes
  const zone = zones(initial)[0]!
  // The east wall moved out to x = 9; a new bridge wall closes the corner it left.
  const bridge = WallNode.parse({
    id: 'wall_bridge',
    parentId: levelId,
    start: [8, 0],
    end: [9, 0],
    thickness: 0.2,
  })
  const level = initial[levelId] as LevelNode
  const moved = {
    ...initial,
    wall_1: { ...initial.wall_1, start: [9, 0], end: [9, 4] } as WallNode,
    wall_2: { ...initial.wall_2, start: [9, 4] } as WallNode,
    [bridge.id]: bridge,
    [levelId]: { ...level, children: [...level.children, bridge.id] } as LevelNode,
  }
  const result = run(moved).nodes
  expect(zones(result).map((room) => room.id)).toEqual([zone.id])
  expect(zones(result)[0]!.polygon).toContainEqual([9, 0])
  expect(zones(result)[0]!.boundaryWallIds).toContain(bridge.id)
  assertIdempotent(result)
})

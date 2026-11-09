import { describe, expect, test } from 'bun:test'
import {
  type AnyNode,
  DoorNode,
  LevelNode,
  reconcileSceneStructure,
  SlabNode,
  WallNode,
  ZoneNode,
} from '@pascal-app/core'
import { paintScopeRole, resolvePaintScopeTargets } from './paint-scope'
import {
  mergePaintSurfaces,
  paintSurfaceMeshes,
  plateAffectedSurfaces,
  platePreviewSurfaces,
} from './plate-paint-affected'

const square = (x: number): [number, number][] => [
  [x, 0],
  [x + 4, 0],
  [x + 4, 4],
  [x, 4],
]
const level = LevelNode.parse({ id: 'level_paint' })
const kitchen = ZoneNode.parse({
  id: 'zone_kitchen',
  name: 'Kitchen',
  parentId: level.id,
  spaceRole: 'room',
  polygon: square(0),
})
const hall = ZoneNode.parse({
  id: 'zone_hall',
  name: 'Hall',
  parentId: level.id,
  spaceRole: 'room',
  polygon: square(4),
  floorStepFinish: 'library:oak',
  floorEdgeFinish: 'library:stone',
})
const base = SlabNode.parse({
  id: 'slab_base',
  parentId: level.id,
  boundary: 'auto',
  plateRole: 'base',
  polygon: [
    [0, 0],
    [8, 0],
    [8, 4],
    [0, 4],
  ],
  zoneIds: [kitchen.id, hall.id],
})
const platform = SlabNode.parse({
  id: 'slab_platform',
  parentId: level.id,
  boundary: 'auto',
  plateRole: 'platform',
  polygon: square(4),
  zoneIds: [hall.id],
})
const manual = SlabNode.parse({ id: 'slab_manual', parentId: level.id, polygon: square(20) })
const nodes = Object.fromEntries(
  [level, kitchen, hall, base, platform, manual].map((n) => [n.id, n]),
) as Record<string, AnyNode>

const keys = (surfaces: ReturnType<typeof plateAffectedSurfaces>) =>
  (surfaces ?? []).map((s) => `${s.nodeId}:${s.role}`).sort()

describe('what one paint click changes on the floor plates (point 7)', () => {
  test('a room’s steps are one finish on every plate of the level', () => {
    expect(keys(plateAffectedSurfaces(nodes, base, 'step:zone_kitchen'))).toEqual([
      'slab_base:step:zone_kitchen',
      'slab_platform:step:zone_kitchen',
    ])
  })

  test('a room floor with painted steps or a region paint stands alone', () => {
    expect(keys(plateAffectedSurfaces(nodes, platform, 'room:zone_hall'))).toEqual([
      'slab_base:room:zone_hall',
      'slab_platform:room:zone_hall',
    ])
    expect(keys(plateAffectedSurfaces(nodes, base, 'room:zone_kitchen/region_1'))).toEqual([
      'slab_base:room:zone_kitchen/region_1',
      'slab_platform:room:zone_kitchen/region_1',
    ])
  })

  test('the footprint edge band carries the edges of its rooms that have no edge finish', () => {
    expect(keys(plateAffectedSurfaces(nodes, base, 'edge'))).toEqual([
      'slab_base:edge',
      'slab_base:edge:zone_kitchen',
      'slab_platform:edge:zone_kitchen',
    ])
  })

  test('other plate faces are just themselves; a hand-drawn slab keeps its own path', () => {
    expect(keys(plateAffectedSurfaces(nodes, base, 'riser'))).toEqual(['slab_base:riser'])
    expect(plateAffectedSurfaces(nodes, manual, 'surface')).toBeNull()
  })
})

/** A | B | C in a row, a door in each dividing wall, B raised: one step per door. */
function doorwayRow(): Record<string, AnyNode> {
  const ring = (x0: number, x1: number): [number, number][] => [
    [x0, 0],
    [x1, 0],
    [x1, 4],
    [x0, 4],
  ]
  const outline = ring(0, 12)
  const walls = outline.map((start, i) =>
    WallNode.parse({ parentId: 'level_row', start, end: outline[(i + 1) % 4], thickness: 0.2 }),
  )
  const doors = ['door_ab', 'door_bc'].map((id) =>
    DoorNode.parse({
      id,
      parentId: `wall_${id}`,
      wallId: `wall_${id}`,
      width: 1,
      height: 2,
      position: [2, 1, 0],
    }),
  )
  const dividers = [4, 8].map((x, i) =>
    WallNode.parse({
      id: `wall_${doors[i]!.id}`,
      parentId: 'level_row',
      start: [x, 0],
      end: [x, 4],
      thickness: 0.2,
      children: [doors[i]!.id],
    }),
  )
  const zones = ['a', 'b', 'c'].map((name, i) =>
    ZoneNode.parse({
      id: `zone_${name}`,
      parentId: 'level_row',
      name,
      spaceRole: 'room',
      enclosureStatus: 'enclosed',
      polygon: ring(i * 4, (i + 1) * 4),
      floor: { elevation: i === 1 ? 0.3 : 0.05 },
    }),
  )
  const children = [...walls, ...dividers, ...zones]
  const level = LevelNode.parse({ id: 'level_row', height: 3, children: children.map((n) => n.id) })
  let minted = 0
  return reconcileSceneStructure({
    nodes: Object.fromEntries([level, ...children, ...doors].map((n) => [n.id, n])),
    mintId: (kind) => `${kind}_row${++minted}`,
  }).nodes as Record<string, AnyNode>
}

// B is raised between A and C, a door on each side: B owns one step per door.
describe('doorway steps: hover, preview and commit are the same set', () => {
  const row = doorwayRow()
  const plates = Object.values(row).filter(
    (node): node is SlabNode => node.type === 'slab' && node.boundary === 'auto',
  )
  const plate = plates.find((slab) => slab.plateRole === 'platform')!
  const onPlates = (...roles: string[]) =>
    plates.flatMap((slab) => roles.map((role) => `${slab.id}:${role}`)).sort()
  type Obj = {
    userData: Record<string, unknown>
    isMesh?: boolean
    traverse: (visit: (o: Obj) => void) => void
  }
  const mesh = (paintRole: string): Obj => ({
    isMesh: true,
    userData: { paintRole, __fromGeometry: true },
    traverse(visit) {
      visit(this)
    },
  })
  const floorB = mesh('room:zone_b')
  const stepAB = mesh('step:zone_b/door_ab')
  const stepBC = mesh('step:zone_b/door_bc')
  const root: Obj = {
    userData: {},
    traverse(visit) {
      for (const child of [floorB, stepAB, stepBC]) visit(child)
    },
  }
  const outlined = (surfaces: ReturnType<typeof plateAffectedSurfaces>) =>
    paintSurfaceMeshes(surfaces!, (id) => (id === plate.id ? root : null))
  const targets = (role: string, scope: 'single' | 'room') =>
    resolvePaintScopeTargets({
      node: plate,
      role,
      scope,
      nodes: row,
      spaces: {},
      slotRolesOf: () => [],
    })
      .map((target) => `${target.nodeId}:${target.role}`)
      .sort()

  test('one step: that doorway only, on every plate', () => {
    const role = 'step:zone_b/door_bc'
    expect(paintScopeRole(plate, role, 'single')).toBe(role)
    expect(targets(role, 'single')).toEqual(onPlates(role))
    const affected = plateAffectedSurfaces(row, plate, role)
    expect(keys(affected)).toEqual(onPlates(role))
    expect(outlined(affected)).toEqual([stepBC])
  })

  test('the room scope: every step of the room', () => {
    const role = paintScopeRole(plate, 'step:zone_b/door_bc', 'room')
    expect(role).toBe('step:zone_b')
    expect(targets('step:zone_b/door_bc', 'room')).toEqual(onPlates(role))
    expect(outlined(plateAffectedSurfaces(row, plate, role))).toEqual([stepAB, stepBC])
  })

  test('a floor paint carries only the steps that follow the floor', () => {
    expect(keys(plateAffectedSurfaces(row, plate, 'room:zone_b'))).toEqual(
      onPlates('room:zone_b', 'step:zone_b/door_ab', 'step:zone_b/door_bc'),
    )
    const painted = {
      ...row,
      zone_b: { ...row.zone_b!, floorStepOverrides: [{ key: 'door_bc', finish: 'library:x' }] },
    } as Record<string, AnyNode>
    const affected = plateAffectedSurfaces(painted, plate, 'room:zone_b')
    expect(keys(affected)).toEqual(onPlates('room:zone_b', 'step:zone_b/door_ab'))
    expect(outlined(affected)).toEqual([floorB, stepAB])
    // The preview is the click targets plus the fallbacks, once each.
    expect(mergePaintSurfaces([{ nodeId: plate.id, role: 'room:zone_b' }], affected)).toHaveLength(
      affected!.length,
    )
  })
})

describe('the whole room: what it paints, erases, and where it previews', () => {
  const row = doorwayRow()
  const plates = Object.values(row).filter(
    (node): node is SlabNode => node.type === 'slab' && node.boundary === 'auto',
  )
  const plate = plates.find((slab) => slab.plateRole === 'platform')!
  const onPlates = (...roles: string[]) =>
    plates.flatMap((slab) => roles.map((role) => `${slab.id}:${role}`)).sort()
  const zoneB = row.zone_b as ZoneNode
  const withB = (patch: Partial<ZoneNode>) =>
    ({ ...row, zone_b: { ...zoneB, ...patch } }) as Record<string, AnyNode>

  test('painted, the whole room is its floor, its painted parts and the steps that follow it', () => {
    const rug = withB({
      floor: {
        ...zoneB.floor,
        regions: [{ id: 'rug', polygon: square(4), finish: 'library:red' }],
      },
    } as Partial<ZoneNode>)
    expect(keys(plateAffectedSurfaces(rug, plate, 'room:zone_b/*'))).toEqual(
      onPlates('room:zone_b', 'room:zone_b/rug', 'step:zone_b/door_ab', 'step:zone_b/door_bc'),
    )
    const nodes = withB({ floorStepOverrides: [{ key: 'door_bc', finish: 'library:x' }] })
    expect(keys(plateAffectedSurfaces(nodes, plate, 'room:zone_b/*'))).toEqual(
      onPlates('room:zone_b', 'step:zone_b/door_ab'),
    )
    // A room step finish holds the steps: the floor goes alone.
    expect(
      keys(plateAffectedSurfaces(withB({ floorStepFinish: 'library:y' }), plate, 'room:zone_b/*')),
    ).toEqual(onPlates('room:zone_b'))
  })

  test('erased, it also clears its painted parts and its edge; doorway paint stays', () => {
    const nodes = withB({
      floorStepFinish: 'library:y',
      floorEdgeFinish: 'library:stone',
      floorStepOverrides: [{ key: 'door_bc', finish: 'library:x' }],
      floor: {
        ...zoneB.floor,
        finish: 'library:oak',
        regions: [{ id: 'rug', polygon: square(4), finish: 'library:red' }],
      },
    } as Partial<ZoneNode>)
    expect(keys(plateAffectedSurfaces(nodes, plate, 'room:zone_b/*', { erasing: true }))).toEqual(
      onPlates('edge:zone_b', 'room:zone_b', 'room:zone_b/rug', 'step:zone_b/door_ab'),
    )
  })

  test('a floor previews on every plate; its steps are drawn by that preview', () => {
    expect(keys(platePreviewSurfaces(row, plate, 'room:zone_b'))).toEqual(onPlates('room:zone_b'))
    expect(keys(platePreviewSurfaces(row, plate, 'room:zone_b/*'))).toEqual(
      onPlates('room:zone_b/*'),
    )
    expect(keys(platePreviewSurfaces(row, plate, 'step:zone_b'))).toEqual(onPlates('step:zone_b'))
  })
})

describe("a footprint's edge band previews where its rooms' edges are drawn", () => {
  test('the band itself, and the plates drawing the edges that carry it', () => {
    expect(keys(platePreviewSurfaces(nodes, base, 'edge'))).toEqual([
      'slab_base:edge',
      'slab_platform:edge',
    ])
    expect(keys(platePreviewSurfaces(nodes, base, 'foundation'))).toEqual(['slab_base:foundation'])
    expect(platePreviewSurfaces(nodes, manual, 'surface')).toBeNull()
  })
})

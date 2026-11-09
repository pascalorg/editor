import { beforeEach, describe, expect, test } from 'bun:test'
import {
  type AnyNode,
  type AnyNodeId,
  BuildingNode,
  clearPlateSurfaceCaches,
  type GeometryContext,
  LevelNode,
  SiteNode,
  SlabNode,
  WallNode,
  ZoneNode,
} from '@pascal-app/core'
import { type Group, type Material, Mesh } from 'three'
import { buildSlabGeometry } from '../geometry'

const WOOD = 'library:wood-woodplank48'
const TILE = 'library:flooring-tiles3'
const TERRAZZO = 'library:flooring-terrazzo19'

function wall(id: string, start: [number, number], end: [number, number]) {
  return WallNode.parse({ id, parentId: 'level_1', start, end, thickness: 0.2, height: 2.5 })
}

function room(id: string, polygon: Array<[number, number]>, floor?: ZoneNode['floor']) {
  return ZoneNode.parse({
    id,
    parentId: 'level_1',
    name: id,
    polygon,
    spaceRole: 'room',
    ...(floor ? { floor } : {}),
  })
}

function context(children: AnyNode[]): GeometryContext {
  const site = SiteNode.parse({ id: 'site_1', children: ['building_1'] })
  const building = BuildingNode.parse({
    id: 'building_1',
    parentId: site.id,
    children: ['level_1'],
  })
  const level = LevelNode.parse({
    id: 'level_1',
    parentId: building.id,
    level: 0,
    height: 2.5,
    children: children.map((child) => child.id),
  })
  const nodes: Record<string, AnyNode> = {
    [site.id]: site,
    [building.id]: building,
    level_1: level,
  }
  for (const child of children) nodes[child.id] = child
  return {
    resolve: <N = AnyNode>(id: AnyNodeId) => nodes[id] as N | undefined,
    children: [],
    siblings: children.filter((child) => child.type === 'slab'),
    parent: level,
  }
}

function meshes(group: Group): Mesh[] {
  return group.children.filter((child): child is Mesh => child instanceof Mesh)
}

/** The mesh drawing the plate top directly above `point`, or null when masked. */
function topMeshAt(group: Group, point: readonly [number, number]): Mesh | null {
  for (const mesh of meshes(group)) {
    const position = mesh.geometry.getAttribute('position')
    for (let index = 0; index + 2 < position.count; index += 3) {
      const corners = [0, 1, 2].map((offset) => ({
        x: position.getX(index + offset),
        y: position.getY(index + offset),
        z: position.getZ(index + offset),
      }))
      const [a, b, c] = corners as [(typeof corners)[0], (typeof corners)[0], (typeof corners)[0]]
      // Only the flat top cap: horizontal, and wound so its normal points up.
      if (Math.abs(a.y - b.y) > 1e-9 || Math.abs(a.y - c.y) > 1e-9) continue
      const twice = (b.x - a.x) * (c.z - a.z) - (c.x - a.x) * (b.z - a.z)
      if (twice >= -1e-12) continue
      const sign = (p: { x: number; z: number }, q: { x: number; z: number }) =>
        (q.x - p.x) * (point[1] - p.z) - (q.z - p.z) * (point[0] - p.x)
      const [s0, s1, s2] = [sign(a, b), sign(b, c), sign(c, a)]
      const negative = s0 < -1e-9 || s1 < -1e-9 || s2 < -1e-9
      const positive = s0 > 1e-9 || s1 > 1e-9 || s2 > 1e-9
      if (!(negative && positive)) return mesh
    }
  }
  return null
}

function roleAt(group: Group, point: readonly [number, number]): string | null {
  return (topMeshAt(group, point)?.userData.slotId as string | undefined) ?? null
}

function materialAt(group: Group, point: readonly [number, number]): Material | null {
  const mesh = topMeshAt(group, point)
  return mesh ? (mesh.material as Material) : null
}

/** Two 4 × 4 rooms sharing a divider; room A carries a finish region. */
function twoRoomScene(finishes: { a?: string; b?: string; region?: string } = {}) {
  const walls = [
    wall('wall_n', [0, 0], [8.2, 0]),
    wall('wall_e', [8.2, 0], [8.2, 4.2]),
    wall('wall_s', [8.2, 4.2], [0, 4.2]),
    wall('wall_w', [0, 4.2], [0, 0]),
    wall('wall_mid', [4.1, 0], [4.1, 4.2]),
  ]
  const zoneA = room(
    'zone_a',
    [
      [0, 0],
      [4.1, 0],
      [4.1, 4.2],
      [0, 4.2],
    ],
    {
      ...(finishes.a ? { finish: finishes.a } : {}),
      ...(finishes.region
        ? {
            regions: [
              {
                id: 'region_1',
                finish: finishes.region,
                polygon: [
                  [0.5, 0.5],
                  [2, 0.5],
                  [2, 2],
                  [0.5, 2],
                ],
              },
            ],
          }
        : {}),
    },
  )
  const zoneB = room(
    'zone_b',
    [
      [4.1, 0],
      [8.2, 0],
      [8.2, 4.2],
      [4.1, 4.2],
    ],
    finishes.b ? { finish: finishes.b } : undefined,
  )
  const plate = SlabNode.parse({
    id: 'slab_plate',
    parentId: 'level_1',
    boundary: 'auto',
    autoFromWalls: true,
    zoneIds: ['zone_a', 'zone_b'],
    elevation: 0.05,
    thickness: 0.2,
    polygon: [
      [-0.1, -0.1],
      [8.3, -0.1],
      [8.3, 4.3],
      [-0.1, 4.3],
    ],
  })
  const manual = SlabNode.parse({
    id: 'slab_manual',
    parentId: 'level_1',
    elevation: 0.05,
    thickness: 0.05,
    polygon: [
      [6, 2],
      [7.5, 2],
      [7.5, 3.5],
      [6, 3.5],
    ],
  })
  return { plate, ctx: context([...walls, zoneA, zoneB, plate, manual]) }
}

describe('floor plate rendering', () => {
  beforeEach(() => {
    clearPlateSurfaceCaches()
  })

  test('draws each room finish, the region and the plate slot on the same top', () => {
    const { plate, ctx } = twoRoomScene({ a: WOOD, b: TILE, region: TERRAZZO })
    const group = buildSlabGeometry(plate, ctx, 'rendered', true)

    expect(roleAt(group, [1, 1])).toBe('room:zone_a/region_1')
    expect(roleAt(group, [3, 3])).toBe('room:zone_a')
    expect(roleAt(group, [0.6, 3.5])).toBe('room:zone_a')
    expect(roleAt(group, [5, 1])).toBe('room:zone_b')
    expect(roleAt(group, [7, 1])).toBe('room:zone_b')
    // Under the divider wall and the outer wall the plate draws its own slot.
    expect(roleAt(group, [4.1, 2])).toBe('surface')
    expect(roleAt(group, [0, 2])).toBe('surface')
    // The manual slab covers the plate top here, so the plate draws nothing.
    expect(roleAt(group, [6.75, 2.75])).toBeNull()

    const roles = meshes(group).map((mesh) => mesh.userData.slotId as string)
    expect(roles).toEqual([
      'room:zone_a/region_1',
      'room:zone_a',
      'room:zone_b',
      'surface',
      'edge',
      'underside',
    ])
    // Six meshes, four materials: the plate's `surface` default is the same
    // wood room A is painted with, and `edge`/`underside` share the side default.
    expect(new Set(meshes(group).map((mesh) => (mesh.material as Material).uuid)).size).toBe(4)
  })

  test('rooms painted alike share one material instance, so batches stay whole', () => {
    const { plate, ctx } = twoRoomScene({ a: WOOD, b: WOOD })
    const group = buildSlabGeometry(plate, ctx, 'rendered', true)
    expect(materialAt(group, [3, 3])).toBe(materialAt(group, [5, 1])!)
    const tiled = twoRoomScene({ a: WOOD, b: TILE })
    clearPlateSurfaceCaches()
    const mixed = buildSlabGeometry(tiled.plate, tiled.ctx, 'rendered', true)
    expect(materialAt(mixed, [3, 3])).not.toBe(materialAt(mixed, [5, 1])!)
  })

  test('the top and its UVs are identical across two builds', () => {
    const { plate, ctx } = twoRoomScene({ a: WOOD, b: TILE, region: TERRAZZO })
    const first = buildSlabGeometry(plate, ctx, 'rendered', true)
    clearPlateSurfaceCaches()
    const second = buildSlabGeometry(plate, ctx, 'rendered', true)
    const dump = (group: Group) =>
      meshes(group).map((mesh) => [
        mesh.userData.slotId,
        Array.from(mesh.geometry.getAttribute('position').array as Float32Array),
        Array.from(mesh.geometry.getAttribute('uv').array as Float32Array),
      ])
    expect(dump(second)).toEqual(dump(first))
  })

  test('a finish keeps the plate UV mapping, so it tiles across the room', () => {
    const { plate, ctx } = twoRoomScene({ a: WOOD, b: TILE })
    const group = buildSlabGeometry(plate, ctx, 'rendered', true)
    const mesh = topMeshAt(group, [3, 3])!
    const position = mesh.geometry.getAttribute('position')
    const uv = mesh.geometry.getAttribute('uv')
    // The slab cap maps UVs to metres as (x, −z) — unchanged by the partition.
    for (let index = 0; index < position.count; index += 1) {
      expect(uv.getX(index)).toBeCloseTo(position.getX(index), 5)
      expect(uv.getY(index)).toBeCloseTo(-position.getZ(index), 5)
    }
  })

  test('an unfinished plate keeps a single surface mesh', () => {
    const { plate, ctx } = twoRoomScene()
    const group = buildSlabGeometry(plate, ctx, 'rendered', true)
    expect(meshes(group).map((mesh) => mesh.userData.slotId)).toEqual([
      'surface',
      'edge',
      'underside',
    ])
  })

  test('a manual slab still renders exactly two meshes', () => {
    const manual = SlabNode.parse({
      id: 'slab_manual_only',
      parentId: 'level_1',
      polygon: [
        [0, 0],
        [2, 0],
        [2, 2],
        [0, 2],
      ],
    })
    const group = buildSlabGeometry(manual, context([manual]), 'rendered', true)
    expect(meshes(group).map((mesh) => mesh.userData.slotId)).toEqual(['surface', 'side'])
  })
})

describe('plate side exposure rendering', () => {
  beforeEach(() => {
    clearPlateSurfaceCaches()
  })

  test('splits the sides into edge, riser and underside', () => {
    const plate = SlabNode.parse({
      id: 'slab_upper',
      parentId: 'level_1',
      boundary: 'auto',
      autoFromWalls: true,
      zoneIds: ['zone_upper'],
      elevation: 0.05,
      thickness: 0.2,
      polygon: [
        [0, 0],
        [4, 0],
        [4, 4],
        [0, 4],
      ],
    })
    const lower = SlabNode.parse({
      id: 'slab_lower',
      parentId: 'level_1',
      boundary: 'auto',
      autoFromWalls: true,
      zoneIds: ['zone_lower'],
      elevation: -0.25,
      thickness: 0.2,
      polygon: [
        [4, 0],
        [8, 0],
        [8, 4],
        [4, 4],
      ],
    })
    const nodes = [
      wall('wall_n', [0, 0], [4, 0]),
      room('zone_upper', [
        [0, 0],
        [4, 0],
        [4, 4],
        [0, 4],
      ]),
      room('zone_lower', [
        [4, 0],
        [8, 0],
        [8, 4],
        [4, 4],
      ]),
      plate,
      lower,
    ]
    const group = buildSlabGeometry(plate, context(nodes), 'rendered', true)
    const byRole = new Map(meshes(group).map((mesh) => [mesh.userData.slotId as string, mesh]))
    expect([...byRole.keys()].sort()).toEqual(['edge', 'riser', 'surface', 'underside'])

    // Every riser triangle sits on the east edge, where the step down is.
    const riser = byRole.get('riser')!.geometry.getAttribute('position')
    for (let index = 0; index < riser.count; index += 1) expect(riser.getX(index)).toBeCloseTo(4, 6)
    // The downturn closes below the soffit with a bottom and back returns.
    const underside = byRole.get('underside')!.geometry.getAttribute('position')
    for (let index = 0; index < underside.count; index += 1) {
      expect(underside.getY(index)).toBeGreaterThanOrEqual(-0.250001)
      expect(underside.getY(index)).toBeLessThanOrEqual(-0.149999)
    }
    // The north edge (under the wall) and the outer edges draw with `edge`.
    const edge = byRole.get('edge')!.geometry.getAttribute('position')
    let onNorth = 0
    for (let index = 0; index < edge.count; index += 1) {
      if (Math.abs(edge.getZ(index)) < 1e-6) onNorth += 1
    }
    expect(onNorth).toBeGreaterThan(0)
  })
})

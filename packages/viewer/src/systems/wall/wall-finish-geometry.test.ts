// @ts-expect-error — bun:test is provided by the Bun runtime; viewer does not
// depend on @types/bun so the import type is unresolved at compile time.
import { afterEach, describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import {
  type AnyNode,
  buildWallFinishLayout,
  calculateLevelMiters,
  DoorNode,
  extractRooms,
  resolveWallFinish,
  sceneRegistry,
  useScene,
  WallNode,
  WindowNode,
  wallFinishMaterialIndex,
  ZoneNode,
} from '@pascal-app/core'
import * as THREE from 'three'
import { getWallFinishRefs } from './wall-finish-data'
import plainGolden from './wall-finish-plain-golden.json'
import { getMaterialsForWall } from './wall-materials'
import { generateExtrudedWall, markWallsForZoneFinishChanges } from './wall-system'

// Two rooms on the a side of one host wall, split by a partition at x = 4.
function fixture(host: Record<string, unknown> = {}) {
  const wall = (id: string, start: [number, number], end: [number, number], extra = {}) =>
    WallNode.parse({ id, parentId: 'level_f', start, end, height: 2.5, ...extra })
  const walls = [
    wall('wall_host', [0, 0], [8, 0], host),
    wall('wall_east', [8, 0], [8, 4]),
    wall('wall_north', [8, 4], [0, 4]),
    wall('wall_west', [0, 4], [0, 0]),
    wall('wall_partition', [4, 0], [4, 4]),
  ]
  const zone = (name: 'A' | 'B', extra: Partial<ZoneNode> = {}) => {
    const room = extractRooms(walls).find((candidate) =>
      candidate.referencePolygon.every(([x]) => (name === 'A' ? x <= 4 : x >= 4)),
    )!
    return ZoneNode.parse({
      id: `zone_${name}`,
      parentId: 'level_f',
      name,
      polygon: room.referencePolygon,
      boundaryWallIds: [...new Set(room.spans.map((span) => span.boundaryId))],
      ...extra,
    })
  }
  return { walls, host: walls[0]!, zone }
}

type Triangle = { centroid: THREE.Vector3; vertices: THREE.Vector3[]; materialIndex: number }

function triangles(geometry: THREE.BufferGeometry): Triangle[] {
  const position = geometry.getAttribute('position')
  const index = geometry.index
  const out: Triangle[] = []
  for (const group of geometry.groups) {
    for (let offset = group.start; offset < group.start + group.count; offset += 3) {
      const vertices = [0, 1, 2].map((corner) => {
        const at = index ? index.getX(offset + corner) : offset + corner
        return new THREE.Vector3(position.getX(at), position.getY(at), position.getZ(at))
      })
      const centroid = vertices
        .reduce((sum, vertex) => sum.add(vertex), new THREE.Vector3())
        .multiplyScalar(1 / 3)
      out.push({ centroid, vertices, materialIndex: group.materialIndex ?? 0 })
    }
  }
  return out
}

function hashGeometry(geometry: THREE.BufferGeometry) {
  const hash = createHash('sha256')
  for (const key of Object.keys(geometry.attributes).sort())
    hash.update(Buffer.from(geometry.attributes[key]!.array.buffer))
  if (geometry.index) hash.update(Buffer.from(geometry.index.array.buffer))
  hash.update(JSON.stringify(geometry.groups))
  return hash.digest('hex')
}

function build(wall: WallNode, walls: WallNode[], zones: ZoneNode[], children: AnyNode[] = []) {
  const mesh = new THREE.Mesh()
  sceneRegistry.nodes.set(wall.id, mesh)
  try {
    return generateExtrudedWall(
      wall,
      children,
      calculateLevelMiters(walls),
      0,
      0,
      undefined,
      undefined,
      undefined,
      undefined,
      buildWallFinishLayout(wall, zones),
    )
  } finally {
    sceneRegistry.nodes.delete(wall.id)
    mesh.geometry.dispose()
  }
}

describe('wall finish geometry', () => {
  // Golden produced by the committed pre-phase-7 wall system (see `source` in the JSON).
  test('plain walls keep the exact bytes of the committed pre-finish build', () => {
    const cases = plainGolden.cases as Array<{
      name: string
      group: keyof typeof plainGolden.groups
      wallId: string
      children: unknown[]
    }>
    expect(cases.length).toBeGreaterThanOrEqual(13)
    for (const entry of cases) {
      const walls = (plainGolden.groups[entry.group] as unknown[]).map((wall) =>
        WallNode.parse(wall),
      )
      const wall = walls.find((candidate) => candidate.id === entry.wallId)!
      const children = entry.children.map((child) => {
        const raw = child as { type: string }
        return (raw.type === 'door' ? DoorNode : WindowNode).parse(raw)
      })
      // Rooms without a wall finish must not change a byte either.
      const zones = extractRooms(walls).map((room, index) =>
        ZoneNode.parse({
          id: `zone_golden_${index}`,
          parentId: 'level_golden',
          name: 'Room',
          polygon: room.referencePolygon,
          boundaryWallIds: [...new Set(room.spans.map((span) => span.boundaryId))],
        }),
      )
      const geometry = build(wall, walls, zones, children)
      expect([entry.name, hashGeometry(geometry)]).toEqual([
        entry.name,
        (plainGolden.hashes as Record<string, string>)[entry.name],
      ])
      expect(getWallFinishRefs(geometry)).toEqual([])
      geometry.dispose()
    }
  })

  for (const withDoor of [false, true]) {
    test(`regions and room spans split and group the faces${withDoor ? ' through the opening CSG' : ''}`, () => {
      const { walls, host, zone } = fixture({
        faceRegions: [{ id: 'wainscot', face: 'a', u0: 1, u1: 5, v1: 0.9, finish: 'library:wood' }],
      })
      const zones = [
        zone('A', { wallMaterial: 'library:room-a' }),
        zone('B', {
          wallMaterial: 'library:room-b',
          wallOverrides: [{ wallId: 'wall_host', face: 'a', finish: 'library:override-b' }],
        }),
      ]
      const door = DoorNode.parse({
        id: 'door_finish',
        wallId: host.id,
        position: [6.5, 1.05, 0],
        width: 0.9,
        height: 2.1,
      })
      const geometry = build(host, walls, zones, withDoor ? [door] : [])
      const layout = buildWallFinishLayout(host, zones)
      expect(getWallFinishRefs(geometry)).toEqual(layout.refs)
      expect(layout.refs).toEqual(['library:override-b', 'library:room-a', 'library:wood'])

      const half = (host.thickness ?? 0.1) / 2
      let faceA = 0
      for (const triangle of triangles(geometry)) {
        const onFace = triangle.vertices.every((vertex) => Math.abs(vertex.z - half) < 1e-5)
        if (!onFace) continue
        faceA += 1
        // No face triangle straddles a split: every vertex sits on one side of each bound.
        for (const bound of [1, 4, 5]) {
          const sides = new Set(
            triangle.vertices
              .filter((vertex) => Math.abs(vertex.x - bound) > 1e-5)
              .map((vertex) => vertex.x > bound),
          )
          expect(sides.size).toBeLessThanOrEqual(1)
        }
        const sides = new Set(
          triangle.vertices
            .filter((vertex) => Math.abs(vertex.y - 0.9) > 1e-5)
            .map((vertex) => vertex.y > 0.9),
        )
        expect(sides.size).toBeLessThanOrEqual(1)
        const hit = resolveWallFinish(layout, 'a', triangle.centroid.x, triangle.centroid.y)
        expect(triangle.materialIndex).toBe(wallFinishMaterialIndex(layout, 'a', hit))
      }
      expect(faceA).toBeGreaterThan(0)
      const used = new Set(triangles(geometry).map((triangle) => triangle.materialIndex))
      // caps, outside face b, room A, room B override, the wainscot — face a's own slot is covered.
      expect(used).toEqual(new Set([0, 2, 3, 4, 5]))
      geometry.dispose()
    })
  }

  test('terrain infill below the base splits and groups with the face above it', () => {
    const wall = WallNode.parse({
      id: 'wall_fill',
      start: [0, 0],
      end: [4, 0],
      height: 2.5,
      thickness: 0.2,
      fillToTerrain: true,
      faceRegions: [{ id: 'stripe', face: 'a', u0: 1.1, u1: 2.1, finish: 'library:stripe' }],
    })
    const mesh = new THREE.Mesh()
    sceneRegistry.nodes.set(wall.id, mesh)
    const layout = buildWallFinishLayout(wall, [])
    const geometry = generateExtrudedWall(
      wall,
      [],
      calculateLevelMiters([wall]),
      1.5,
      1.5,
      undefined,
      4,
      () => 0.4,
      undefined,
      layout,
    )
    sceneRegistry.nodes.delete(wall.id)
    let fillTriangles = 0
    for (const triangle of triangles(geometry)) {
      const onFaceA = triangle.vertices.every((vertex) => Math.abs(vertex.z - 0.1) < 1e-5)
      if (!(onFaceA && triangle.centroid.y < 0)) continue
      fillTriangles += 1
      // Off the fill's 0.25 m sampling grid, so only a real split puts a vertex there.
      for (const bound of [1.1, 2.1]) {
        const sides = new Set(
          triangle.vertices
            .filter((vertex) => Math.abs(vertex.x - bound) > 1e-5)
            .map((vertex) => vertex.x > bound),
        )
        expect(sides.size).toBeLessThanOrEqual(1)
      }
      const inside = triangle.centroid.x > 1.1 && triangle.centroid.x < 2.1
      expect(triangle.materialIndex).toBe(inside ? 3 : 1)
    }
    expect(fillTriangles).toBeGreaterThan(0)
    geometry.dispose()
  })

  test('the palette appends one shared material per finish ref', () => {
    const { host } = fixture({ slots: { a: 'library:preset-white' } })
    const other = WallNode.parse({
      ...host,
      id: 'wall_other',
      slots: { b: 'library:preset-white' },
    })
    const refs = ['library:preset-cream', 'library:preset-greige']
    const first = getMaterialsForWall(host, 'rendered', true, 'clay', undefined, {}, refs)
    const second = getMaterialsForWall(other, 'rendered', true, 'clay', undefined, {}, refs)
    expect(first.visible).toHaveLength(5)
    expect(first.invisible).toHaveLength(5)
    expect(first.translucent).toHaveLength(5)
    expect(first.visible[3]).toBe(second.visible[3]!)
    expect(first.visible[4]).toBe(second.visible[4]!)
    expect(first.visible[1]).toBe(second.visible[2]!)
    const untextured = getMaterialsForWall(host, 'rendered', false, 'clay', undefined, {}, refs)
    expect(untextured.visible).toHaveLength(5)
  })
})

describe('room finish invalidation', () => {
  afterEach(() => {
    useScene.setState({ nodes: {}, rootNodeIds: [], dirtyNodes: new Set() } as never)
    markWallsForZoneFinishChanges()
  })

  test('a zone finish edit dirties the walls bounding the room, old and new', () => {
    const { walls, zone } = fixture()
    const level = { id: 'level_f', type: 'level', children: [...walls.map((w) => w.id), 'zone_A'] }
    const nodes = (zoneNode: ZoneNode | null) =>
      Object.fromEntries(
        [level, ...walls, ...(zoneNode ? [zoneNode] : [])].map((node) => [node.id, node]),
      )
    const plain = zone('A')
    useScene.setState({ nodes: nodes(plain), dirtyNodes: new Set() } as never)
    markWallsForZoneFinishChanges()
    expect([...useScene.getState().dirtyNodes]).toEqual([])

    // Renaming a room without a wall finish touches no wall.
    useScene.setState({ nodes: nodes({ ...plain, name: 'Kitchen' }) } as never)
    markWallsForZoneFinishChanges()
    expect([...useScene.getState().dirtyNodes]).toEqual([])

    const painted = { ...plain, wallMaterial: 'library:red' }
    useScene.setState({ nodes: nodes(painted) } as never)
    markWallsForZoneFinishChanges()
    expect([...useScene.getState().dirtyNodes].sort()).toEqual([...plain.boundaryWallIds].sort())

    useScene.setState({ dirtyNodes: new Set() } as never)
    useScene.setState({ nodes: nodes(null) } as never)
    markWallsForZoneFinishChanges()
    expect([...useScene.getState().dirtyNodes].sort()).toEqual([...plain.boundaryWallIds].sort())
  })
})

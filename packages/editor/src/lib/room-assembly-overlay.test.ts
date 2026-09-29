import { afterEach, describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import {
  type AnyNode,
  BuildingNode,
  CeilingNode,
  getWallArcData,
  getWallFaceOffsets,
  LevelNode,
  SlabNode,
  sceneRegistry,
  WallNode,
} from '@pascal-app/core'
import { migrateCeilingRoomLinks, migrateRoomZones } from '@pascal-app/core/scene-migrations'
import { BoxGeometry, Mesh, MeshBasicMaterial } from 'three'
import {
  buildRoomAssembly,
  getRoomAssembly,
  type RoomAssemblyHeights,
  resolveRoomAssemblyHeights,
  roomWallFaces,
} from './room-assembly-overlay'
import { RoomSelectionIndex, type RoomSelectionRecord } from './room-selection'

const levelId = 'level_room_assembly'
const buildingId = 'building_room_assembly'

function wall(id: string, start: [number, number], end: [number, number], extra = {}) {
  return WallNode.parse({
    id: `wall_${id}`,
    parentId: levelId,
    start,
    end,
    thickness: 0.2,
    ...extra,
  })
}

function scene(walls: WallNode[], extra: AnyNode[] = []) {
  const raw = Object.fromEntries(
    [
      BuildingNode.parse({ id: buildingId, children: [levelId] }),
      LevelNode.parse({
        id: levelId,
        parentId: buildingId,
        children: [...walls, ...extra].map((node) => node.id),
      }),
      ...walls,
      ...extra,
    ].map((node) => [node.id, node]),
  )
  return migrateCeilingRoomLinks(migrateRoomZones(raw).nodes).nodes as Record<string, AnyNode>
}

// Two 4 x 4 rooms split by `shared`, with a T-stem into the east room.
function twoRooms(extraWalls: WallNode[] = []) {
  return scene([
    wall('south', [0, 0], [8, 0]),
    wall('east', [8, 0], [8, 4]),
    wall('north', [8, 4], [0, 4]),
    wall('west', [0, 4], [0, 0]),
    wall('shared', [4, 0], [4, 4]),
    ...extraWalls,
  ])
}

function roomAt(records: RoomSelectionRecord[], point: [number, number]) {
  const [x, z] = point
  return records.find(({ polygon }) => {
    const xs = polygon.map((p) => p[0])
    const zs = polygon.map((p) => p[1])
    return x > Math.min(...xs) && x < Math.max(...xs) && z > Math.min(...zs) && z < Math.max(...zs)
  })!
}

function withNodes(nodes: Record<string, AnyNode>, ...added: AnyNode[]) {
  const level = nodes[levelId] as LevelNode
  return {
    ...nodes,
    ...Object.fromEntries(added.map((node) => [node.id, node])),
    [levelId]: { ...level, children: [...level.children, ...added.map((node) => node.id)] },
  } as Record<string, AnyNode>
}

const heights = (tops: Record<string, number>, floorY = 0): RoomAssemblyHeights => ({
  floorY,
  wallTops: new Map(Object.entries(tops)),
  ceiling: null,
})

const length = ({ from, to }: { from: readonly number[]; to: readonly number[] }) =>
  Math.hypot(to[0]! - from[0]!, to[1]! - from[1]!)

function yValues(array: Float32Array) {
  const ys = new Set<number>()
  for (let i = 1; i < array.length; i += 3) ys.add(Math.round(array[i]! * 1000) / 1000)
  return [...ys].sort((a, b) => a - b)
}

afterEach(() => sceneRegistry.clear())

describe('room assembly faces', () => {
  test('only the room-facing face, clipped at the partition and the corners', () => {
    const room = roomAt(new RoomSelectionIndex(levelId).update(twoRooms()), [2, 2])
    const faces = roomWallFaces(room.geometry)
    const byWall = new Map<string, typeof faces>()
    for (const face of faces) byWall.set(face.wallId, [...(byWall.get(face.wallId) ?? []), face])
    expect([...byWall.keys()].sort()).toEqual(
      ['wall_north', 'wall_shared', 'wall_south', 'wall_west'].sort(),
    )
    const south = byWall.get('wall_south')!
    expect(south.every(({ face }) => face === 'a')).toBe(true)
    for (const { from, to } of south) {
      expect(from[1]).toBeCloseTo(0.1)
      expect(to[1]).toBeCloseTo(0.1)
      for (const x of [from[0], to[0]]) {
        expect(x).toBeGreaterThanOrEqual(0.1 - 1e-6)
        expect(x).toBeLessThanOrEqual(3.9 + 1e-6)
      }
    }
    expect(south.reduce((sum, face) => sum + length(face), 0)).toBeCloseTo(3.8)
    // The partition contributes its west face only.
    for (const { from, to } of byWall.get('wall_shared')!) {
      expect(from[0]).toBeCloseTo(3.9)
      expect(to[0]).toBeCloseTo(3.9)
    }
  })

  test('a T-stem splits the host face into per-room t-ranges', () => {
    const nodes = twoRooms([wall('stem', [4, 2], [8, 2])])
    const records = new RoomSelectionIndex(levelId).update(nodes)
    const lower = roomAt(records, [6, 1])
    const upper = roomAt(records, [6, 3])
    for (const [room, zMin, zMax] of [
      [lower, 0.1, 1.9],
      [upper, 2.1, 3.9],
    ] as const) {
      const shared = roomWallFaces(room.geometry).filter(({ wallId }) => wallId === 'wall_shared')
      const span = room.spans.find(({ boundaryId }) => boundaryId === 'wall_shared')!
      expect(shared.reduce((sum, face) => sum + length(face), 0)).toBeCloseTo(zMax - zMin)
      for (const { from, to, face } of shared) {
        expect(face).toBe(span.face)
        for (const [x, z] of [from, to]) {
          expect(x).toBeCloseTo(4.1)
          expect(z).toBeGreaterThanOrEqual(zMin - 1e-6)
          expect(z).toBeLessThanOrEqual(zMax + 1e-6)
          const t = z / 4
          expect(t).toBeGreaterThanOrEqual(span.t0 - 1e-6)
          expect(t).toBeLessThanOrEqual(span.t1 + 1e-6)
        }
      }
    }
  })

  test('curved faces follow the offset arc and only draw verticals at their ends', () => {
    const nodes = twoRooms()
    const curved = { ...(nodes.wall_shared as WallNode), curveOffset: 0.5 }
    const room = roomAt(
      new RoomSelectionIndex(levelId).update({ ...nodes, [curved.id]: curved }),
      [1, 2],
    )
    const faces = roomWallFaces(room.geometry).filter(({ wallId }) => wallId === curved.id)
    expect(faces.length).toBeGreaterThan(4)
    const arc = getWallArcData(curved)!
    const face = faces[0]!.face
    const radius = arc.radius - arc.direction * getWallFaceOffsets(curved)[face]
    for (const { from, to } of faces) {
      for (const [x, z] of [from, to])
        expect(Math.hypot(x - arc.center.x, z - arc.center.y)).toBeCloseTo(radius, 2)
    }
    const tops = Object.fromEntries(room.boundaryWallIds.map((id) => [id, 2.5]))
    const { outline } = buildRoomAssembly(room.geometry, heights(tops))
    let verticals = 0
    for (let i = 0; i < outline.length; i += 6) {
      if (
        outline[i + 1]! !== outline[i + 4]! &&
        Math.hypot(outline[i]! - outline[i + 3]!, outline[i + 2]! - outline[i + 5]!) < 1e-6
      )
        verticals++
    }
    // Four walls, two run ends each; the arc's chords share their joints.
    expect(verticals).toBe(8)
  })
})

describe('room assembly geometry', () => {
  test('walls rise from the plate top to their own tops; the ceiling sits at its height', () => {
    const base = twoRooms()
    const initial = roomAt(new RoomSelectionIndex(levelId).update(base), [2, 2])
    const polygon: [number, number][] = [
      [0.1, 0.1],
      [3.9, 0.1],
      [3.9, 3.9],
      [0.1, 3.9],
    ]
    const nodes = withNodes(
      { ...base, wall_south: { ...(base.wall_south as WallNode), height: 2.1 } },
      SlabNode.parse({ parentId: levelId, polygon, zoneIds: [initial.zoneId], elevation: 0.3 }),
      CeilingNode.parse({ parentId: levelId, polygon, zoneId: initial.zoneId, height: 2.4 }),
    )
    const room = roomAt(new RoomSelectionIndex(levelId).update(nodes), [2, 2])
    const resolved = resolveRoomAssemblyHeights(room, nodes)
    expect(resolved.floorY).toBe(0.3)
    expect(resolved.ceiling?.y).toBe(2.4)
    expect(resolved.wallTops.get('wall_south')).toBe(2.1)
    const planeTop = resolved.wallTops.get('wall_west')!
    expect(planeTop).toBeGreaterThan(2.1)
    const assembly = buildRoomAssembly(room.geometry, resolved)
    expect(yValues(assembly.floor)).toEqual([0.305])
    expect(yValues(assembly.surfaces)).toEqual(
      [0.305, 2.1, 2.38, Math.round(planeTop * 1000) / 1000].sort((a, b) => a - b),
    )
    expect(yValues(assembly.outline)).toContain(2.38)
    expect(assembly.floor.length).toBeGreaterThan(0)
  })

  test('cache hits on the same topology revision and misses on topology or height change', () => {
    const index = new RoomSelectionIndex(levelId)
    const nodes = twoRooms()
    const room = roomAt(index.update(nodes), [2, 2])
    const tops = Object.fromEntries(room.boundaryWallIds.map((id) => [id, 2.5]))
    const first = getRoomAssembly(room.geometry, heights(tops))
    // A fresh heights object with equal values and an unrelated scene edit both hit.
    expect(getRoomAssembly(room.geometry, heights({ ...tops }))).toBe(first)
    const zone = nodes[room.zoneId]!
    const renamed = roomAt(
      index.update({ ...nodes, [zone.id]: { ...zone, name: 'Kitchen' } as AnyNode }),
      [2, 2],
    )
    expect(renamed.geometry).toBe(room.geometry)
    expect(getRoomAssembly(renamed.geometry, heights(tops))).toBe(first)
    expect(getRoomAssembly(room.geometry, heights({ ...tops, wall_south: 2 }))).not.toBe(first)
    const moved = roomAt(
      index.update({
        ...nodes,
        wall_shared: { ...(nodes.wall_shared as WallNode), start: [5, 0], end: [5, 4] },
      }),
      [2, 2],
    )
    expect(moved.geometry).not.toBe(room.geometry)
    const rebuilt = getRoomAssembly(moved.geometry, heights(tops))
    expect(rebuilt).not.toBe(first)
    expect(rebuilt.floor.length).toBeGreaterThan(0)
  })

  test('building and resolving never touch the rendered wall meshes', () => {
    const nodes = twoRooms()
    const room = roomAt(new RoomSelectionIndex(levelId).update(nodes), [2, 2])
    const meshes = room.boundaryWallIds.map((id) => {
      const mesh = new Mesh(new BoxGeometry(), new MeshBasicMaterial())
      mesh.userData = { batched: true, pascalId: id }
      sceneRegistry.nodes.set(id, mesh)
      return {
        mesh,
        material: mesh.material,
        geometry: mesh.geometry,
        layers: mesh.layers.mask,
        userData: structuredClone(mesh.userData),
        visible: mesh.visible,
      }
    })
    getRoomAssembly(room.geometry, resolveRoomAssemblyHeights(room, nodes))
    for (const { mesh, material, geometry, layers, userData, visible } of meshes) {
      expect(mesh.material).toBe(material)
      expect(mesh.geometry).toBe(geometry)
      expect(mesh.layers.mask).toBe(layers)
      expect(mesh.userData).toEqual(userData)
      expect(mesh.visible).toBe(visible)
    }
    for (const file of ['./room-assembly-overlay.ts', '../components/editor/room-highlight.tsx']) {
      const source = readFileSync(new URL(file, import.meta.url), 'utf8')
      expect(source).not.toMatch(/\.material\s*=[^=]|userData|sceneRegistry\.nodes\.set/)
    }
  })
})

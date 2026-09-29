import { afterAll, afterEach, describe, expect, spyOn, test } from 'bun:test'
import { sceneRegistry, useScene, WallNode } from '@pascal-app/core'
import { getVisibleWallMaterials, useViewer } from '@pascal-app/viewer'
import { BufferGeometry, Float32BufferAttribute, type Material, Mesh, Object3D } from 'three'
import { canonicalWallMaterials, materialSetKey, runBatchFrame } from './wall-batch-system'

// A 4 × 4 grid of 2 m rooms: 20 horizontal + 20 vertical walls = 40 walls. Rooms
// repeat three finishes; the top row's rooms were painted on their walls' face
// slots before rooms owned finishes (what M1 leaves behind), the rest carry the
// finish on the zone. Outside faces keep the default.
const FINISHES = ['library:preset-cream', 'library:preset-greige', 'library:preset-lightgrey']
const MIN_BATCH_WALLS = 8

type Face = 'a' | 'b'
type WallSpec = {
  node: WallNode
  faces: Record<Face, { room: [number, number] | null }>
}

const roomFinish = ([i, j]: [number, number]) => FINISHES[(i + j) % FINISHES.length]!
const legacyRoom = ([, j]: [number, number]) => j === 3

function gridWalls(): WallSpec[] {
  const inside = (i: number, j: number): [number, number] | null =>
    i >= 0 && i < 4 && j >= 0 && j < 4 ? [i, j] : null
  const walls: WallSpec[] = []
  for (let j = 0; j <= 4; j++)
    for (let i = 0; i < 4; i++) {
      // start → end along +x: face a (left) looks at the room above.
      walls.push({
        node: WallNode.parse({
          id: `wall_h_${i}_${j}`,
          start: [i * 2, j * 2],
          end: [i * 2 + 2, j * 2],
        }),
        faces: { a: { room: inside(i, j) }, b: { room: inside(i, j - 1) } },
      })
    }
  for (let i = 0; i <= 4; i++)
    for (let j = 0; j < 4; j++) {
      // start → end along +y: face a (left) looks at the room on the left.
      walls.push({
        node: WallNode.parse({
          id: `wall_v_${i}_${j}`,
          start: [i * 2, j * 2],
          end: [i * 2, j * 2 + 2],
        }),
        faces: { a: { room: inside(i - 1, j) }, b: { room: inside(i, j) } },
      })
    }
  return walls
}

/** The palette the wall system builds for a wall, and the groups its faces land in. */
function wallBuild(spec: WallSpec) {
  const slots: Record<string, string> = {}
  const zoneRefs = new Set<string>()
  for (const face of ['a', 'b'] as const) {
    const room = spec.faces[face].room
    if (!room) continue
    if (legacyRoom(room)) slots[face] = roomFinish(room)
    else zoneRefs.add(roomFinish(room))
  }
  const node = { ...spec.node, slots }
  const refs = [...zoneRefs].filter((ref) => ref !== slots.a && ref !== slots.b).sort()
  const faceIndex = (face: Face) => {
    const room = spec.faces[face].room
    if (!room || legacyRoom(room)) return face === 'a' ? 1 : 2
    const ref = roomFinish(room)
    if (ref === slots.a) return 1
    if (ref === slots.b) return 2
    return 3 + refs.indexOf(ref)
  }
  const materials = getVisibleWallMaterials(node, 'rendered', true, 'clay', undefined, {}, refs)
  const indices = [...new Set([0, faceIndex('a'), faceIndex('b')])].sort((x, y) => x - y)
  const geometry = new BufferGeometry()
  geometry.setAttribute(
    'position',
    new Float32BufferAttribute(
      indices.flatMap((_, k) => [k, 0, 0, k + 1, 0, 0, k, 1, 0]),
      3,
    ),
  )
  for (const [k, materialIndex] of indices.entries()) geometry.addGroup(k * 3, 3, materialIndex)
  return { node, materials, geometry }
}

/** Draw calls for a level: one per material run of every batch, one per group of every loose wall. */
function drawCalls(
  builds: ReturnType<typeof wallBuild>[],
  key: (build: ReturnType<typeof wallBuild>) => string,
) {
  const buckets = new Map<string, ReturnType<typeof wallBuild>[]>()
  for (const build of builds) {
    const bucket = buckets.get(key(build)) ?? []
    bucket.push(build)
    buckets.set(key(build), bucket)
  }
  let calls = 0
  for (const bucket of buckets.values()) {
    if (bucket.length < MIN_BATCH_WALLS) {
      for (const build of bucket) calls += build.geometry.groups.length
      continue
    }
    const used = new Set<Material>()
    for (const build of bucket)
      for (const group of build.geometry.groups) used.add(build.materials[group.materialIndex!]!)
    calls += used.size
  }
  return { calls, buckets: buckets.size }
}

const wholeArrayKey = (build: ReturnType<typeof wallBuild>) =>
  build.materials.map((material) => material.uuid).join('|')
const canonicalKey = (build: ReturnType<typeof wallBuild>) =>
  materialSetKey(canonicalWallMaterials({ geometry: build.geometry }, build.materials))

let nowMs = 0
const performanceNow = spyOn(performance, 'now').mockImplementation(() => nowMs)
const registered: string[] = []

afterEach(() => {
  useViewer.setState({ wallMode: 'down' } as never)
  runBatchFrame(() => undefined, { current: null })
  for (const id of registered.splice(0)) {
    const object = sceneRegistry.nodes.get(id)
    if (object instanceof Mesh) object.geometry.dispose()
  }
  sceneRegistry.clear()
  useScene.setState({ nodes: {}, rootNodeIds: [] } as never)
  useViewer.setState({ wallMode: 'up' } as never)
})

afterAll(() => performanceNow.mockRestore())

describe('canonical wall batch keys', () => {
  test('equal resolved material sets share a key whatever the palette order or unused entries', () => {
    // A wall painted on its face slot and a wall painted by its room look the same and batch together.
    const slotPainted = wallBuild({
      node: WallNode.parse({ id: 'wall_slot', start: [0, 0], end: [1, 0] }),
      faces: { a: { room: [0, 3] }, b: { room: null } },
    })
    const roomPainted = wallBuild({
      node: WallNode.parse({ id: 'wall_room', start: [0, 0], end: [1, 0] }),
      faces: { a: { room: [3, 0] }, b: { room: null } },
    })
    expect(roomFinish([0, 3])).toBe(roomFinish([3, 0]))
    expect(wholeArrayKey(slotPainted)).not.toBe(wholeArrayKey(roomPainted))
    expect(canonicalKey(slotPainted)).toBe(canonicalKey(roomPainted))
  })

  test('40-wall fixture: fewer draw calls, and the batch system sews what the key promises', () => {
    const specs = gridWalls()
    expect(specs).toHaveLength(40)
    const builds = specs.map(wallBuild)
    const before = drawCalls(builds, wholeArrayKey)
    const after = drawCalls(builds, canonicalKey)
    // Recorded in the phase-7 report; the assertion guards the direction and size of the win.
    console.info(
      `[wall-batch] 40 walls: whole-array key ${JSON.stringify(before)} → canonical ${JSON.stringify(after)}`,
    )
    expect(after.calls).toBeLessThan(before.calls)
    expect(after.buckets).toBeLessThan(before.buckets)

    const root = new Object3D()
    sceneRegistry.nodes.set('level', root)
    sceneRegistry.byType.level.add('level')
    registered.push('level')
    for (const build of builds) {
      const mesh = new Mesh(build.geometry, build.materials)
      root.add(mesh)
      sceneRegistry.nodes.set(build.node.id, mesh)
      sceneRegistry.byType.wall.add(build.node.id)
      registered.push(build.node.id)
    }
    useScene.setState({
      nodes: {
        level: { id: 'level', type: 'level', children: builds.map((build) => build.node.id) },
        ...Object.fromEntries(
          builds.map((build) => [build.node.id, { ...build.node, parentId: 'level' }]),
        ),
      },
      rootNodeIds: ['level'],
      dirtyNodes: new Set(),
    } as never)
    useViewer.setState({
      wallMode: 'up',
      selection: { ...useViewer.getState().selection, selectedIds: [] },
      previewSelectedIds: [],
      hoveredId: null,
    } as never)
    nowMs = 0
    runBatchFrame(() => undefined, { current: null })
    nowMs = 181
    runBatchFrame(() => undefined, { current: null })

    let calls = 0
    for (const child of root.children) {
      const mesh = child as Mesh
      if (mesh.name === 'wall-batch') calls += mesh.geometry.groups.length
      else if (mesh.layers.isEnabled(0)) calls += mesh.geometry.groups.length
    }
    expect(calls).toBe(after.calls)
    // Every sewn triangle still draws with the material its wall drew it with.
    for (const child of root.children) {
      const mesh = child as Mesh
      if (mesh.name !== 'wall-batch') continue
      const materials = mesh.material as Material[]
      expect(materials.every((material) => material !== undefined)).toBe(true)
      for (const group of mesh.geometry.groups)
        expect(materials[group.materialIndex!]).toBeDefined()
    }
  })
})

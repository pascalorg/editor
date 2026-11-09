import { afterAll, afterEach, beforeAll, describe, expect, spyOn, test } from 'bun:test'
import {
  type AnyNodeId,
  LevelNode,
  loadPlugin,
  MaterialPresetPayloadSchema,
  nodeRegistry,
  registerLibraryMaterials,
  runAsSceneCommitAuthor,
  SceneMaterial,
  sceneRegistry,
  unregisterLibraryMaterials,
  useScene,
  WallNode,
} from '@pascal-app/core'
import {
  getVisibleWallMaterials,
  isNodeRevealing,
  SCENE_LAYER,
  startConstructionReveal,
  useViewer,
  WallCutout,
  WallCutoutCache,
  WallSystem,
} from '@pascal-app/viewer'
import { act, create } from '@react-three/test-renderer'
import { createElement, Fragment } from 'react'
import {
  BufferGeometry,
  Float32BufferAttribute,
  type Material,
  Mesh,
  Object3D,
  PerspectiveCamera,
  Texture,
  TextureLoader,
  Vector3,
} from 'three'
import type { MeshStandardNodeMaterial } from 'three/webgpu'
import { getCurtainAwareWallMaterials } from './curtain-wall-materials'
import { wallDefinition } from './definition'
import WallRenderer from './renderer'
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
const actEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
const savedActEnvironment = actEnvironment.IS_REACT_ACT_ENVIRONMENT
const savedRequestAnimationFrame = globalThis.requestAnimationFrame
const savedCancelAnimationFrame = globalThis.cancelAnimationFrame

beforeAll(() => {
  actEnvironment.IS_REACT_ACT_ENVIRONMENT = true
  globalThis.requestAnimationFrame ??= (callback) => {
    callback(0)
    return 0
  }
  globalThis.cancelAnimationFrame ??= () => {}
})

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

afterAll(() => {
  performanceNow.mockRestore()
  actEnvironment.IS_REACT_ACT_ENVIRONMENT = savedActEnvironment
  globalThis.requestAnimationFrame = savedRequestAnimationFrame
  globalThis.cancelAnimationFrame = savedCancelAnimationFrame
})

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

function required<T>(value: T | null | undefined, label: string): T {
  if (value === null || value === undefined) throw new Error(`Expected ${label}`)
  return value
}

function lateBatchFixture(id: string) {
  const root = new Object3D()
  const builds = Array.from({ length: 8 }, (_, index) => {
    const build = wallBuild({
      node: WallNode.parse({
        id: `wall_late_batch_${index}`,
        parentId: 'level_late_batch',
        start: [0, index * 4],
        end: [4, index * 4],
      }),
      faces: { a: { room: null }, b: { room: null } },
    })
    const node = WallNode.parse({
      ...build.node,
      slots: { a: `library:${id}`, b: 'library:preset-white' },
    })
    const mesh = new Mesh(build.geometry, getVisibleWallMaterials(node))
    root.add(mesh)
    sceneRegistry.nodes.set(node.id, mesh)
    sceneRegistry.byType.wall.add(node.id)
    registered.push(node.id)
    return { node, mesh }
  })
  sceneRegistry.nodes.set('level_late_batch', root)
  sceneRegistry.byType.level.add('level_late_batch')
  registered.push('level_late_batch')
  useScene.setState({
    nodes: {
      level_late_batch: LevelNode.parse({
        id: 'level_late_batch',
        children: builds.map(({ node }) => node.id),
      }),
      ...Object.fromEntries(builds.map(({ node }) => [node.id, node])),
    },
    rootNodeIds: ['level_late_batch'],
    dirtyNodes: new Set(),
    materials: {},
  } as never)
  useViewer.setState({
    wallMode: 'up',
    shading: 'rendered',
    textures: true,
    selection: { ...useViewer.getState().selection, selectedIds: [], zoneId: null },
    previewSelectedIds: [],
    hoveredId: null,
    hoverHighlightMode: 'default',
  })
  const cache = new WallCutoutCache(useViewer)
  const camera = new PerspectiveCamera()
  const wake = { current: null as ReturnType<typeof setTimeout> | null }
  return { root, builds, cache, camera, wake }
}

function expectNoVisibleMaterial(root: Object3D, forbidden: Material) {
  for (const child of root.children) {
    const mesh = child as Mesh
    if (!mesh.visible || !mesh.layers.isEnabled(SCENE_LAYER)) continue
    const palette = mesh.material as Material[]
    for (const group of mesh.geometry.groups) {
      if (!group.count) continue
      const index = required(group.materialIndex, 'draw group material index')
      expect(required(palette[index], 'draw group material')).not.toBe(forbidden)
    }
  }
}

test('a late library finish replaces the materials drawn by an already sewn wall batch', () => {
  const id = 'mtl_wall_batch_continuity'
  const { root, builds, cache, camera, wake } = lateBatchFixture(id)
  cache.update(camera, 0)
  nowMs = 0
  runBatchFrame(() => undefined, wake)
  nowMs = 181
  runBatchFrame(() => undefined, wake)
  const old = root.children.find((child) => child.name === 'wall-batch') as Mesh
  expect(old).toBeDefined()
  const first = required(builds[0], 'first wall')
  const fallback = required((first.mesh.material as Material[])[1], 'fallback face material')
  try {
    registerLibraryMaterials([
      {
        id,
        label: 'Late batched wall finish',
        category: 'colors',
        preset: MaterialPresetPayloadSchema.parse({
          maps: {},
          mapProperties: { color: '#2468ac', roughness: 0.27, metalness: 0.63 },
        }),
      },
    ])
    cache.update(camera, 0.2)
    const resolved = (first.mesh.material as Material[])[1] as MeshStandardNodeMaterial
    expect(resolved).not.toBe(fallback)
    expect(resolved.color.getHexString()).toBe('2468ac')
    nowMs = 200
    runBatchFrame(() => undefined, wake)
    // No draw between invalidation and re-sewing may retain the stale finish.
    expectNoVisibleMaterial(root, fallback)
    nowMs = 381
    runBatchFrame(() => undefined, wake)
    const batches = root.children.filter((child) => child.name === 'wall-batch') as Mesh[]
    expect(batches).toHaveLength(1)
    expect(batches[0]).not.toBe(old)
    expect(required(batches[0], 'replacement batch').material as Material[]).toContain(resolved)
    expect(builds.every(({ mesh }) => !mesh.layers.isEnabled(SCENE_LAYER))).toBe(true)
  } finally {
    unregisterLibraryMaterials([id])
    useViewer.setState({ wallMode: 'down' })
    runBatchFrame(() => undefined, wake)
    if (wake.current) clearTimeout(wake.current)
  }
})

// Construction is presentation only: authored paint and metre UVs must survive every
// live frame and the collective draw. Values come from the fixture, not the resolver.
function materialState(material: Material) {
  const surface = material as MeshStandardNodeMaterial
  return {
    type: surface.type,
    color: surface.color?.getHexString(),
    opacity: surface.opacity,
    transparent: surface.transparent,
    depthWrite: surface.depthWrite,
    side: surface.side,
    roughness: surface.roughness,
    metalness: surface.metalness,
    maps: [surface.map, surface.normalMap, surface.roughnessMap].map((map) =>
      map
        ? {
            uuid: map.uuid,
            repeat: map.repeat.toArray(),
            rotation: map.rotation,
            flipY: map.flipY,
            channel: map.channel,
            colorSpace: map.colorSpace,
          }
        : null,
    ),
  }
}

function LiveWalls() {
  const nodes = useScene((state) => state.nodes)
  return createElement(
    'group',
    {},
    ...Object.values(nodes)
      .filter((node): node is WallNode => node.type === 'wall')
      .map((node) => createElement(WallRenderer, { key: node.id, node })),
  )
}

function expectMetreFaceUVs(mesh: Mesh) {
  mesh.updateWorldMatrix(true, false)
  const position = mesh.geometry.getAttribute('position')
  const index = mesh.geometry.index
  let edges = 0
  for (const name of ['uv', 'uv2']) {
    const uv = mesh.geometry.getAttribute(name)
    for (const group of mesh.geometry.groups) {
      if (group.materialIndex !== 1 && group.materialIndex !== 2) continue
      for (let offset = group.start; offset < group.start + group.count; offset += 3) {
        const start = index ? index.getX(offset) : offset
        const a = new Vector3().fromBufferAttribute(position, start).applyMatrix4(mesh.matrixWorld)
        for (const corner of [1, 2]) {
          const end = index ? index.getX(offset + corner) : offset + corner
          const b = new Vector3().fromBufferAttribute(position, end).applyMatrix4(mesh.matrixWorld)
          // One UV unit is one drawn metre, not one pre-animation metre. The opposite
          // face reverses U; both faces keep the resting wall's downward V orientation.
          expect(uv.getX(end) - uv.getX(start)).toBeCloseTo(
            (group.materialIndex === 1 ? 1 : -1) * (b.x - a.x),
            5,
          )
          expect(uv.getY(end) - uv.getY(start)).toBeCloseTo(a.y - b.y, 5)
          edges++
        }
      }
    }
  }
  expect(edges).toBeGreaterThan(0)
}

function registerRevealTexture(id: string) {
  registerLibraryMaterials([
    {
      id,
      label: 'Directional wall texture',
      category: 'colors',
      preset: MaterialPresetPayloadSchema.parse({
        maps: {
          albedoMap: `/fixtures/${id}-albedo.png`,
          normalMap: `/fixtures/${id}-normal.png`,
          roughnessMap: `/fixtures/${id}-roughness.png`,
        },
        mapProperties: {
          color: '#a47345',
          roughness: 0.37,
          metalness: 0.12,
          repeatX: 2,
          repeatY: 3,
          rotation: Math.PI / 2,
        },
      }),
    },
  ])
}

function createRevealFixture(shading: 'solid' | 'rendered') {
  const id = `mtl_wall_reveal_${shading}`
  const textures: Texture[] = []
  const loader = spyOn(TextureLoader.prototype, 'loadAsync').mockImplementation(async () => {
    const texture = new Texture()
    textures.push(texture)
    return texture
  })
  const paint = SceneMaterial.parse({
    id: 'smat_reveal_paint',
    name: 'Face paint',
    material: { properties: { color: '#2468ac', roughness: 0.61, metalness: 0.08 } },
  })
  const walls = Array.from({ length: 8 }, (_, index) =>
    WallNode.parse({
      id: `wall_material_reveal_${index}`,
      start: [0, index * 4],
      end: [4, index * 4],
      height: 2.5,
      thickness: 0.2,
      slots: { a: `scene:${paint.id}`, b: `library:${id}` },
    }),
  )
  return {
    id,
    shading,
    paint,
    walls,
    textures,
    loader,
    level: LevelNode.parse({ id: 'level_material_reveal', level: 0 }),
    savedScene: useScene.getState(),
    savedViewer: useViewer.getState(),
    restoreRegistry: nodeRegistry._snapshot(),
    renderer: undefined as Awaited<ReturnType<typeof create>> | undefined,
    driver: undefined as ReturnType<typeof startConstructionReveal> | undefined,
    root: undefined as Object3D | undefined,
    wake: { current: null as ReturnType<typeof setTimeout> | null },
    samples: new Map<string, { materials: Material[]; states: unknown[] }>(),
    rising: new Set<string>(),
  }
}

type RevealFixture = ReturnType<typeof createRevealFixture>

async function mountRevealFixture(fixture: RevealFixture) {
  const { level, paint, shading, walls } = fixture
  nodeRegistry._reset()
  await loadPlugin({ id: 'fixture:wall-materials', apiVersion: 1, nodes: [wallDefinition] })
  registerRevealTexture(fixture.id)
  useScene.getState().setScene({ [level.id]: level }, [level.id as AnyNodeId], {
    installedPlugins: ['fixture:wall-materials'],
    hasExplicitPluginInstallState: true,
  })
  useScene.setState({ materials: { [paint.id]: paint }, dirtyNodes: new Set() })
  useViewer.setState({
    shading,
    textures: true,
    wallMode: 'up',
    colorPreset: 'clay',
    sceneTheme: 'studio',
    selection: { ...fixture.savedViewer.selection, selectedIds: [], zoneId: null },
    previewSelectedIds: [],
    hoveredId: null,
    hoverHighlightMode: 'default',
  })
  fixture.renderer = await create(
    createElement(
      Fragment,
      {},
      createElement(LiveWalls),
      createElement(WallCutout, { materialResolver: getCurtainAwareWallMaterials }),
      createElement(WallSystem),
    ),
  )
  fixture.root = required(fixture.renderer.scene.children[0], 'mounted level').instance as Object3D
  sceneRegistry.nodes.set(level.id, fixture.root)
  sceneRegistry.byType.level.add(level.id)
  fixture.driver = startConstructionReveal({
    reveals: (commit) => commit.author === 'agent',
    prefersReducedMotion: () => false,
    level: () => 'full',
  })
  await act(async () => {
    runAsSceneCommitAuthor('agent', () =>
      useScene.getState().createNodes(walls.map((node) => ({ node, parentId: level.id }))),
    )
  })
}

function expectRevealingWall(fixture: RevealFixture, wall: WallNode, mesh: Mesh) {
  const materials = mesh.material as Material[]
  const faceA = materials[1] as MeshStandardNodeMaterial
  const faceB = materials[2] as MeshStandardNodeMaterial
  expect(faceA.color.getHexString()).toBe('2468ac')
  expect(faceB.color.getHexString()).toBe('a47345')
  expect(faceA.transparent).toBe(false)
  expect(faceB.opacity).toBe(1)
  expect(faceB.type).toBe(
    fixture.shading === 'solid' ? 'MeshLambertNodeMaterial' : 'MeshStandardNodeMaterial',
  )
  expect(faceB.map).not.toBeNull()
  const map = required(faceB.map, 'textured wall albedo map')
  expect(map.repeat.toArray()).toEqual([2, 3])
  expect(map.rotation).toBe(Math.PI / 2)
  if (fixture.shading === 'rendered') {
    expect(faceB.normalMap).not.toBeNull()
    expect(faceB.roughnessMap).not.toBeNull()
    expect(faceB.roughness).toBe(0.37)
    expect(faceB.metalness).toBe(0.12)
  }
  const saved = fixture.samples.get(wall.id)
  if (saved) {
    materials.forEach((material, index) => {
      expect(material).toBe(saved.materials[index])
    })
    expect(materials.map(materialState)).toEqual(saved.states)
  } else {
    fixture.samples.set(wall.id, {
      materials: [...materials],
      states: materials.map(materialState),
    })
  }
  mesh.updateMatrix()
  const scaleY = required(mesh.matrix.elements[5], 'wall world Y scale')
  if (scaleY > 0.05 && scaleY < 0.95) {
    fixture.rising.add(wall.id)
    expect(isNodeRevealing(wall.id)).toBe(true)
    expect(mesh.layers.isEnabled(SCENE_LAYER)).toBe(true)
    expectMetreFaceUVs(mesh)
  }
}

async function advanceRevealFixture(fixture: RevealFixture) {
  const driver = required(fixture.driver, 'construction driver')
  const renderer = required(fixture.renderer, 'mounted renderer')
  nowMs = 0
  for (let frame = 0; frame < 300; frame++) {
    nowMs += 20
    await act(async () => {
      driver.tick(nowMs)
      await renderer.advanceFrames(1, 0.02)
    })
    runBatchFrame(() => undefined, fixture.wake)
    for (const wall of fixture.walls) {
      const mesh = sceneRegistry.nodes.get(wall.id) as Mesh | undefined
      if (mesh && !mesh.geometry.userData.placeholder) expectRevealingWall(fixture, wall, mesh)
    }
  }
}

// Compare the submitted UV/material tuples, allowing palette, vertex and triangle reordering.
function triangleMaterialUVs(mesh: Mesh) {
  const uv = mesh.geometry.getAttribute('uv')
  const index = mesh.geometry.index
  const palette = mesh.material as Material[]
  return mesh.geometry.groups.flatMap((group) =>
    Array.from({ length: group.count }, (_, offset) => {
      const at = index ? index.getX(group.start + offset) : group.start + offset
      const materialIndex = required(group.materialIndex, 'triangle material index')
      const material = required(palette[materialIndex], 'triangle material')
      return `${material.uuid}:${uv.getX(at)}:${uv.getY(at)}`
    }),
  )
}

function expectSettledRevealBatch(fixture: RevealFixture) {
  expect(fixture.samples.size).toBe(8)
  expect(fixture.rising.size).toBe(8)
  const root = required(fixture.root, 'level root')
  const batches = root.children.filter((child) => child.name === 'wall-batch') as Mesh[]
  expect(batches).toHaveLength(1)
  const batch = required(batches[0], 'settled wall batch')
  const sources = fixture.walls.map((wall) => sceneRegistry.nodes.get(wall.id) as Mesh)
  expect(triangleMaterialUVs(batch).sort()).toEqual(sources.flatMap(triangleMaterialUVs).sort())
  for (const wall of fixture.walls) {
    const mesh = sceneRegistry.nodes.get(wall.id) as Mesh
    expect(isNodeRevealing(wall.id)).toBe(false)
    expect(mesh.layers.isEnabled(SCENE_LAYER)).toBe(false)
    mesh.updateMatrix()
    expect(mesh.matrix.elements[5]).toBe(1)
    expectMetreFaceUVs(mesh)
  }
}

async function disposeRevealFixture(fixture: RevealFixture) {
  await act(async () => fixture.driver?.stop())
  useViewer.setState({ wallMode: 'down' })
  runBatchFrame(() => undefined, fixture.wake)
  if (fixture.wake.current) clearTimeout(fixture.wake.current)
  await fixture.renderer?.unmount()
  fixture.restoreRegistry()
  unregisterLibraryMaterials([fixture.id])
  fixture.loader.mockRestore()
  for (const texture of fixture.textures) texture.dispose()
  sceneRegistry.clear()
  useScene.setState(fixture.savedScene)
  useViewer.setState(fixture.savedViewer)
}

test.each(['solid', 'rendered'] as const)(
  '%s painted and textured wall faces keep their materials and UVs while rising and joining a batch',
  async (shading) => {
    const fixture = createRevealFixture(shading)
    try {
      await mountRevealFixture(fixture)
      await advanceRevealFixture(fixture)
      expectSettledRevealBatch(fixture)
    } finally {
      await disposeRevealFixture(fixture)
    }
  },
)

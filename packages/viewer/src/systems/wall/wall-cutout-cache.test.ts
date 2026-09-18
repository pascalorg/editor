import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test'
import {
  BuildingNode,
  LevelNode,
  MaterialPresetPayloadSchema,
  registerLibraryMaterials,
  SceneMaterial,
  SiteNode,
  sceneRegistry,
  unregisterLibraryMaterials,
  useLiveTransforms,
  useScene,
  WallNode,
} from '@pascal-app/core'
import {
  BoxGeometry,
  Group,
  type Material,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  Texture,
  TextureLoader,
  Vector3,
} from 'three'
import { createStore, type StoreApi } from 'zustand/vanilla'
import { applyMaterialPresetToMaterials } from '../../lib/materials'
import { getWallHideState, runWallCutoutFrame, WALL_CUTOUT_FRAME_PRIORITY } from './wall-cutout'
import {
  sameMaterialArray,
  WALL_FACING_HYSTERESIS,
  WallCutoutCache,
  type WallCutoutViewerState,
  wallFacingNegative,
} from './wall-cutout-cache'
import { getMaterialsForWall } from './wall-materials'
import {
  drainRebuiltWalls,
  notifyWallRebuilt,
  subscribeWallRebuilds,
} from './wall-rebuild-notifications'

const sceneBefore = useScene.getState()
let viewerStore: StoreApi<WallCutoutViewerState>
let cache: WallCutoutCache
let camera: PerspectiveCamera
let unsubscribe: () => void
let unsubscribeTransforms: () => void

function addWall(frontSide = 'exterior', backSide = 'interior') {
  const node = WallNode.parse({ start: [0, 0], end: [4, 0], frontSide, backSide })
  const mesh = new Mesh()
  sceneRegistry.nodes.set(node.id, mesh)
  sceneRegistry.byType.wall!.add(node.id)
  useScene.setState({ nodes: { ...useScene.getState().nodes, [node.id]: node } })
  return { node, mesh }
}

function trackWrites(mesh: Mesh) {
  let material = mesh.material
  let hidden = mesh.userData.wallHidden
  const writes = { material: 0, stamp: 0 }
  Object.defineProperty(mesh, 'material', {
    configurable: true,
    get: () => material,
    set: (value: Material | Material[]) => {
      material = value
      writes.material++
    },
  })
  Object.defineProperty(mesh.userData, 'wallHidden', {
    configurable: true,
    get: () => hidden,
    set: (value: boolean) => {
      hidden = value
      writes.stamp++
    },
  })
  return writes
}

beforeEach(() => {
  sceneRegistry.clear()
  useScene.setState({ nodes: {}, materials: {} })
  viewerStore = createStore<WallCutoutViewerState>(() => ({
    wallMode: 'cutaway',
    shading: 'solid',
    textures: false,
    colorPreset: 'clay',
    sceneTheme: 'studio',
    selection: { buildingId: null, levelId: null, zoneId: null, selectedIds: [] },
    previewSelectedIds: [],
    hoveredId: null,
    hoverHighlightMode: 'default',
  }))
  useLiveTransforms.getState().clearAll()
  cache = new WallCutoutCache(viewerStore)
  unsubscribeTransforms = cache.subscribeLiveTransforms()
  camera = new PerspectiveCamera()
  unsubscribe = subscribeWallRebuilds((id) => cache.rebuilt.add(id))
})

afterEach(() => {
  unsubscribe()
  unsubscribeTransforms()
  useLiveTransforms.getState().clearAll()
  drainRebuiltWalls(new Set())
  sceneRegistry.clear()
  useScene.setState(sceneBefore)
})

describe('WallCutoutCache', () => {
  test('camera orbit in full height never iterates cached walls or reads camera direction', () => {
    viewerStore.setState({ wallMode: 'up' })
    const { mesh } = addWall()
    const writes = trackWrites(mesh)
    cache.update(camera, 1)
    const direction = spyOn(camera, 'getWorldDirection')
    const registry = spyOn(sceneRegistry.nodes, 'get')
    const wallIteration = spyOn(cache.walls, Symbol.iterator)
    for (let i = 0; i < 100; i++) {
      camera.position.x += 1
      camera.rotation.y += 0.1
      cache.update(camera, 2 + i)
    }
    expect(direction).not.toHaveBeenCalled()
    expect(registry).not.toHaveBeenCalled()
    expect(wallIteration).not.toHaveBeenCalled()
    expect(writes).toEqual({ material: 1, stamp: 1 })
    direction.mockRestore()
    registry.mockRestore()
    wallIteration.mockRestore()
  })

  test('only facing flips write materials and stamps; unchanged normals are never refreshed', () => {
    const { mesh } = addWall()
    const writes = trackWrites(mesh)
    cache.update(camera, 1)
    expect(mesh.userData.wallHidden).toBe(true)
    const matrices = spyOn(mesh, 'updateWorldMatrix')
    for (let i = 0; i < 10; i++) {
      camera.position.x++
      cache.update(camera, 2 + i)
    }
    expect(writes).toEqual({ material: 1, stamp: 1 })
    expect(matrices).not.toHaveBeenCalled()
    camera.rotation.y = Math.PI
    cache.update(camera, 20)
    expect(mesh.userData.wallHidden).toBe(false)
    expect(writes).toEqual({ material: 2, stamp: 2 })
    matrices.mockRestore()
  })

  test('coalesces small movement and preserves the existing time gate', () => {
    const { mesh } = addWall()
    cache.update(camera, 1)
    const dot = spyOn(cache.walls.values().next().value!.normal, 'dot')
    camera.position.x = 0.1
    cache.update(camera, 2)
    expect(dot).not.toHaveBeenCalled()
    camera.rotation.y = Math.PI
    cache.update(camera, 1.05)
    expect(mesh.userData.wallHidden).toBe(true)
    cache.update(camera, 2)
    expect(mesh.userData.wallHidden).toBe(false)
    expect(dot).toHaveBeenCalledTimes(1)
    dot.mockRestore()
  })

  test('adds, removes and replaces meshes even when the wall count is unchanged', () => {
    const first = addWall()
    cache.update(camera, 1)
    sceneRegistry.nodes.delete(first.node.id)
    sceneRegistry.byType.wall!.delete(first.node.id)
    const second = addWall()
    cache.update(camera, 1.01)
    expect(cache.walls.has(first.node.id)).toBe(false)
    expect(cache.walls.get(second.node.id)?.mesh).toBe(second.mesh)
    expect(second.mesh.userData.wallHidden).toBe(true)
    const replacement = new Mesh()
    replacement.rotation.y = Math.PI
    sceneRegistry.nodes.set(second.node.id, replacement)
    cache.update(camera, 1.02)
    expect(cache.walls.get(second.node.id)?.mesh).toBe(replacement)
    expect(replacement.userData.wallHidden).toBe(false)
  })

  test('rebuild completion updates only the moved wall before the batch drains the same notice', () => {
    const moved = addWall()
    const other = addWall()
    cache.update(camera, 1)
    const otherMatrix = spyOn(other.mesh, 'updateWorldMatrix')
    moved.mesh.rotation.y = Math.PI
    moved.mesh.geometry = new BoxGeometry()
    notifyWallRebuilt(moved.node.id)
    cache.update(camera, 1.01)
    expect(moved.mesh.userData.wallHidden).toBe(false)
    expect(cache.walls.get(moved.node.id)?.normal.z).toBeCloseTo(-1)
    expect(otherMatrix).not.toHaveBeenCalled()
    const batchChanges = new Set<string>()
    drainRebuiltWalls(batchChanges)
    expect(batchChanges.has(moved.node.id)).toBe(true)
    expect(cache.rebuilt.size).toBe(0)
    otherMatrix.mockRestore()
  })

  test('scene transform and side changes refresh facing with a stationary camera', () => {
    const { node, mesh } = addWall()
    const parent = new Group()
    const ancestor = BuildingNode.parse({})
    useScene.setState({
      nodes: { [ancestor.id]: ancestor, [node.id]: { ...node, parentId: ancestor.id } },
    })
    parent.add(mesh)
    cache.update(camera, 1)
    parent.rotation.y = Math.PI
    useScene.setState({
      nodes: {
        ...useScene.getState().nodes,
        [ancestor.id]: { ...ancestor, rotation: [0, Math.PI, 0] },
      },
    })
    cache.update(camera, 1.01)
    expect(mesh.userData.wallHidden).toBe(false)
    useScene.setState({
      nodes: { [node.id]: { ...node, frontSide: 'interior', backSide: 'interior' } },
    })
    cache.update(camera, 1.02)
    expect(mesh.userData.wallHidden).toBe(true)
  })

  for (const schema of [SiteNode, BuildingNode, LevelNode]) {
    test(`live ${schema.parse({}).type} rotation, commit and cancel refresh descendant normals`, () => {
      const parentNode = schema.parse({})
      const parent = new Group()
      const { node, mesh } = addWall()
      parent.add(mesh)
      useScene.setState({
        nodes: {
          ...useScene.getState().nodes,
          [parentNode.id]: parentNode,
          [node.id]: { ...node, parentId: parentNode.id },
        },
      })
      const nodes = useScene.getState().nodes
      cache.update(camera, 1)
      const publish = (rotation: number) => {
        parent.rotation.y = rotation
        useLiveTransforms.getState().set(parentNode.id, { position: [0, 0, 0], rotation })
        cache.update(camera, 1.01)
        expect(mesh.userData.wallHidden).toBe(
          getWallHideState(node, mesh, 'cutaway', new Vector3(0, 0, -1)),
        )
      }
      publish(Math.PI)
      expect(mesh.userData.wallHidden).toBe(false)
      publish(0)
      publish(Math.PI)
      expect(useScene.getState().nodes).toBe(nodes)
      useLiveTransforms.getState().clear(parentNode.id)
      cache.update(camera, 1.02)
      expect(mesh.userData.wallHidden).toBe(false)
      publish(0)
      parent.rotation.y = Math.PI
      useLiveTransforms.getState().clearAll()
      cache.update(camera, 1.03)
      expect(mesh.userData.wallHidden).toBe(false)
    })
  }

  test('same-facing scans repair restored materials and corrupted stamps', () => {
    const { mesh } = addWall()
    cache.update(camera, 1)
    const expected = mesh.material
    mesh.material = [new MeshBasicMaterial()]
    mesh.userData.wallHidden = false
    camera.position.x++
    cache.update(camera, 2)
    expect(mesh.material).toBe(expected)
    expect(mesh.userData.wallHidden).toBe(true)
  })

  test('paint hover preserves preview through cache updates and restores current appearance on leave', () => {
    viewerStore.setState({ wallMode: 'up' })
    const { node, mesh } = addWall()
    cache.update(camera, 1)
    const original = mesh.material
    const preview = [new MeshBasicMaterial()]
    viewerStore.setState({ hoveredId: node.id })
    viewerStore.setState({ hoverHighlightMode: 'paint-ready' })
    mesh.material = preview
    const normal = spyOn(mesh, 'updateWorldMatrix')
    cache.update(camera, 1.01)
    expect(mesh.material).toBe(preview)
    expect(normal).not.toHaveBeenCalled()
    viewerStore.setState({ wallMode: 'cutaway' })
    cache.update(camera, 1.02)
    camera.position.x++
    cache.update(camera, 2)
    expect(mesh.material).toBe(preview)
    mesh.material = original
    viewerStore.setState({ hoveredId: null, hoverHighlightMode: 'default' })
    cache.update(camera, 2.01)
    expect(mesh.material).toBe(cache.walls.get(node.id)!.hiddenVariant.materials)
    normal.mockRestore()
  })

  test('appearance changes during preview are applied when temporary ownership ends', () => {
    viewerStore.setState({ wallMode: 'up' })
    const { node, mesh } = addWall()
    cache.update(camera, 1)
    const original = mesh.material
    const preview = [new MeshBasicMaterial()]
    viewerStore.setState({ hoveredId: node.id, hoverHighlightMode: 'paint-ready' })
    mesh.material = preview
    viewerStore.setState({ colorPreset: 'white' })
    cache.update(camera, 1.01)
    expect(mesh.material).toBe(preview)
    mesh.material = original
    viewerStore.setState({ hoveredId: null, hoverHighlightMode: 'default' })
    cache.update(camera, 1.02)
    expect(mesh.material).toBe(cache.walls.get(node.id)!.visibleVariant.materials)
    expect(mesh.material).not.toBe(original)
  })

  test('a live ancestor above the level updates every descendant once', () => {
    const building = BuildingNode.parse({})
    const level = LevelNode.parse({ parentId: building.id })
    const outer = new Group()
    const inner = new Group()
    outer.add(inner)
    const walls = [addWall(), addWall()]
    for (const { node, mesh } of walls) {
      inner.add(mesh)
      useScene.setState({
        nodes: {
          ...useScene.getState().nodes,
          [building.id]: building,
          [level.id]: level,
          [node.id]: { ...node, parentId: level.id },
        },
      })
    }
    cache.update(camera, 1)
    const outerUpdate = spyOn(outer, 'updateWorldMatrix')
    const innerUpdate = spyOn(inner, 'updateWorldMatrix')
    outer.rotation.y = Math.PI
    useLiveTransforms.getState().set(building.id, { position: [0, 0, 0], rotation: Math.PI })
    cache.update(camera, 1.01)
    expect(outerUpdate).toHaveBeenCalledTimes(1)
    expect(innerUpdate).toHaveBeenCalledTimes(1)
    for (const { mesh } of walls) expect(mesh.userData.wallHidden).toBe(false)
    outerUpdate.mockRestore()
    innerUpdate.mockRestore()
  })

  test('scopes node edits to their wall paths and updates shared ancestors once', () => {
    const parents = Array.from({ length: 4 }, () => ({
      node: BuildingNode.parse({}),
      mesh: new Group(),
    }))
    const walls = Array.from({ length: 100 }, (_, i) => {
      const wall = addWall()
      const parent = parents[i % 4]!
      parent.mesh.add(wall.mesh)
      useScene.setState({
        nodes: {
          ...useScene.getState().nodes,
          [parent.node.id]: parent.node,
          [wall.node.id]: { ...wall.node, parentId: parent.node.id },
        },
      })
      return wall
    })
    cache.update(camera, 1)
    const parentUpdates = parents.map(({ mesh }) => spyOn(mesh, 'updateWorldMatrix'))
    const wallUpdates = walls.map(({ mesh }) => spyOn(mesh, 'updateWorldMatrix'))
    const variants = walls.map(({ node }) => cache.walls.get(node.id)!.visibleVariant)
    const unrelated = BuildingNode.parse({})
    useScene.setState({ nodes: { ...useScene.getState().nodes, [unrelated.id]: unrelated } })
    cache.update(camera, 1.01)
    for (const spy of [...parentUpdates, ...wallUpdates]) expect(spy).not.toHaveBeenCalled()
    walls.forEach(({ node }, i) => {
      expect(cache.walls.get(node.id)!.visibleVariant).toBe(variants[i])
    })
    const changed = parents[0]!
    changed.mesh.rotation.y = Math.PI
    useScene.setState({
      nodes: {
        ...useScene.getState().nodes,
        [changed.node.id]: { ...changed.node, rotation: [0, Math.PI, 0] },
      },
    })
    cache.update(camera, 1.02)
    parentUpdates.forEach((spy, i) => {
      expect(spy).toHaveBeenCalledTimes(i === 0 ? 1 : 0)
    })
    wallUpdates.forEach((spy, i) => {
      expect(spy).toHaveBeenCalledTimes(i % 4 === 0 ? 1 : 0)
    })
    walls.forEach(({ node, mesh }, i) => {
      expect(mesh.userData.wallHidden).toBe(i % 4 !== 0)
      if (i % 4 !== 0) expect(cache.walls.get(node.id)!.visibleVariant).toBe(variants[i])
    })
    for (const spy of [...parentUpdates, ...wallUpdates]) spy.mockRestore()
  })

  test('appearance changes do not revisit transforms', () => {
    const { mesh } = addWall()
    cache.update(camera, 1)
    const matrix = spyOn(mesh, 'updateWorldMatrix')
    viewerStore.setState({ colorPreset: 'white' })
    cache.update(camera, 1.01)
    expect(matrix).not.toHaveBeenCalled()
    matrix.mockRestore()
  })

  test('frame priority order renders camera stamps before rebuilds and passes them to the batch', () => {
    const { node, mesh } = addWall()
    const state = { camera, clock: { elapsedTime: 0 } }
    const callbacks: { callback: () => void; priority: number }[] = []
    const registerFrame = (callback: () => void, priority: number) => {
      callbacks.push({ callback, priority })
    }
    const advance = (time: number) => {
      state.clock.elapsedTime = time
      for (const { callback } of callbacks.toSorted((a, b) => a.priority - b.priority)) callback()
    }
    const rendered: boolean[] = []
    const batched: boolean[] = []
    const batchChanges = new Set<string>()
    let rebuild = false
    registerFrame(() => rendered.push(mesh.userData.wallHidden), 1)
    registerFrame(() => {
      if (!rebuild) return
      mesh.rotation.y = Math.PI
      notifyWallRebuilt(node.id)
      rebuild = false
    }, 4)
    registerFrame(() => {
      drainRebuiltWalls(batchChanges)
      batched.push(mesh.userData.wallHidden)
    }, 5)
    registerFrame(() => runWallCutoutFrame(cache, state), WALL_CUTOUT_FRAME_PRIORITY)

    advance(1)
    camera.rotation.y = Math.PI
    advance(2)
    expect(rendered).toEqual([true, false])
    expect(batched).toEqual(rendered)
    rebuild = true
    advance(3)
    expect(rendered[2]).toBe(false)
    expect(batched[2]).toBe(false)
    expect(batchChanges.has(node.id)).toBe(true)
    expect(cache.rebuilt.has(node.id)).toBe(true)
    advance(3.01)
    expect(rendered).toEqual([true, false, false, true])
    expect(batched).toEqual(rendered)
    expect(cache.rebuilt.size).toBe(0)
  })

  test('mode round trips immediately lift stamps and preserve low/translucent semantics', () => {
    const { mesh } = addWall()
    cache.update(camera, 1)
    for (const [mode, hidden] of [
      ['up', false],
      ['down', true],
      ['translucent', false],
      ['cutaway', true],
    ] as const) {
      viewerStore.setState({ wallMode: mode })
      cache.update(camera, 1.01)
      expect(mesh.userData.wallHidden).toBe(hidden)
      expect(cache.walls.values().next().value!.variantKey).toBe(
        mode === 'translucent' ? 'translucent' : hidden ? 'invisible' : 'visible',
      )
    }
  })

  test('appearance and highlight refreshes do not reassign an already-current material array', () => {
    const { node, mesh } = addWall()
    viewerStore.setState({ wallMode: 'up' })
    const writes = trackWrites(mesh)
    cache.update(camera, 1)
    viewerStore.setState({ hoveredId: node.id })
    cache.update(camera, 1.01)
    expect(writes.material).toBe(1)
    viewerStore.setState({
      selection: { ...viewerStore.getState().selection, selectedIds: [node.id] },
    })
    cache.update(camera, 1.02)
    expect(writes.material).toBe(2)
    viewerStore.setState({ previewSelectedIds: [node.id] })
    cache.update(camera, 1.03)
    expect(writes.material).toBe(2)
    expect(writes.stamp).toBe(1)
    viewerStore.setState({ hoverHighlightMode: 'delete' })
    cache.update(camera, 1.04)
    expect(cache.walls.get(node.id)?.variantKey).toBe('delete-visible')
    expect(writes.material).toBe(3)
  })

  test('all appearance inputs refresh in full height without camera movement', () => {
    const { node, mesh } = addWall()
    viewerStore.setState({ wallMode: 'up' })
    cache.update(camera, 1)
    const patches = [
      { shading: 'rendered' as const },
      { colorPreset: 'white' as const },
      { sceneTheme: 'dark' },
      { textures: true },
    ]
    for (const patch of patches) {
      viewerStore.setState(patch)
      cache.update(camera, 1.01)
      const v = viewerStore.getState()
      expect(
        sameMaterialArray(
          mesh.material,
          getMaterialsForWall(
            node,
            v.shading,
            v.textures,
            v.colorPreset,
            v.sceneTheme,
            useScene.getState().materials,
          ).visible,
        ),
      ).toBe(true)
    }
    const painted = WallNode.parse({ ...node, material: { properties: { color: '#ff0000' } } })
    useScene.setState({ nodes: { [node.id]: painted } })
    cache.update(camera, 1.02)
    expect(cache.walls.get(node.id)?.node).toBe(painted)
  })

  test('scene palette edits and late library registration replace cached materials immediately', () => {
    const { node, mesh } = addWall()
    const material = SceneMaterial.parse({
      id: 'mat_row14_test',
      name: 'red',
      material: { properties: { color: '#ff0000' } },
    })
    const painted = WallNode.parse({
      ...node,
      slots: { interior: `scene:${material.id}`, exterior: 'library:mtl_row14_test' },
    })
    useScene.setState({ nodes: { [node.id]: painted }, materials: { [material.id]: material } })
    viewerStore.setState({ wallMode: 'up', textures: true })
    cache.update(camera, 1)
    const red = (mesh.material as Material[])[1]
    useScene.setState({
      materials: {
        [material.id]: SceneMaterial.parse({
          ...material,
          material: { properties: { color: '#0000ff' } },
        }),
      },
    })
    cache.update(camera, 1.01)
    expect((mesh.material as Material[])[1] === red).toBe(false)
    const unresolved = (mesh.material as Material[])[2]
    try {
      registerLibraryMaterials([
        {
          id: 'mtl_row14_test',
          label: 'test',
          category: 'colors',
          preset: MaterialPresetPayloadSchema.parse({
            maps: {},
            mapProperties: { color: '#00ff00' },
          }),
        },
      ])
      cache.update(camera, 1.02)
      expect((mesh.material as Material[])[2] === unresolved).toBe(false)
    } finally {
      unregisterLibraryMaterials(['mtl_row14_test'])
    }
  })

  test('selected wall clones pick up a late texture with a stationary full-height camera', async () => {
    const { node, mesh } = addWall()
    viewerStore.setState({
      wallMode: 'up',
      selection: { ...viewerStore.getState().selection, selectedIds: [node.id] },
    })
    cache.update(camera, 1)
    const viewer = viewerStore.getState()
    const source = getMaterialsForWall(
      node,
      viewer.shading,
      viewer.textures,
      viewer.colorPreset,
      viewer.sceneTheme,
    ).visible[1]! as Material & { map: Texture | null }
    const originalMap = source.map
    const texture = new Texture()
    const loader = spyOn(TextureLoader.prototype, 'loadAsync').mockResolvedValue(texture)
    try {
      applyMaterialPresetToMaterials(
        source,
        MaterialPresetPayloadSchema.parse({
          maps: { albedoMap: '/row14-late-texture.png' },
          mapProperties: {},
        }),
      )
      await new Promise((resolve) => setTimeout(resolve, 0))
      cache.update(camera, 1.01)
      expect(
        ((mesh.material as Material[])[1] as Material & { map: Texture }).map === source.map,
      ).toBe(true)
      expect(source.map).not.toBeNull()
      const loadedMap = source.map
      let reads = 0
      Object.defineProperty(source, 'map', {
        configurable: true,
        get: () => {
          reads++
          return loadedMap
        },
      })
      for (let i = 0; i < 100; i++) cache.update(camera, 2 + i)
      expect(reads).toBe(0)
      Object.defineProperty(source, 'map', { configurable: true, writable: true, value: loadedMap })
    } finally {
      loader.mockRestore()
      source.map = originalMap
      texture.dispose()
    }
  })

  test('face-band changes remove whole-wall selection highlighting immediately', () => {
    const { node } = addWall()
    viewerStore.setState({
      wallMode: 'up',
      selection: { ...viewerStore.getState().selection, selectedIds: [node.id] },
    })
    cache.update(camera, 1)
    expect(cache.walls.get(node.id)?.variantKey).toBe('selection-visible')
    useScene.setState({
      nodes: { [node.id]: WallNode.parse({ ...node, faceBands: { enabled: true, count: 3 } }) },
    })
    cache.update(camera, 1.01)
    expect(cache.walls.get(node.id)?.variantKey).toBe('visible')
  })

  test('cached semantics match the public facing helper away from the hysteresis band', () => {
    for (const front of ['interior', 'exterior'])
      for (const back of ['interior', 'exterior']) {
        const { node, mesh } = addWall(front, back)
        for (const mode of ['up', 'cutaway', 'down', 'translucent'] as const) {
          viewerStore.setState({ wallMode: mode })
          for (const angle of [0, Math.PI]) {
            camera.rotation.y = angle
            cache.update(camera, 2 + angle)
            const expected = getWallHideState(
              node,
              mesh,
              mode,
              camera.getWorldDirection(new Vector3()),
            )
            expect(mesh.userData.wallHidden).toBe(mode !== 'translucent' && expected)
          }
        }
      }
  })
})

test('hysteresis holds both sides near zero and switches beyond the band', () => {
  const e = WALL_FACING_HYSTERESIS
  expect(wallFacingNegative(-e / 2, undefined)).toBe(true)
  expect(wallFacingNegative(0, undefined)).toBe(false)
  for (const dot of [-e / 2, 0, e / 2]) {
    expect(wallFacingNegative(dot, false)).toBe(false)
    expect(wallFacingNegative(dot, true)).toBe(true)
  }
  expect(wallFacingNegative(-2 * e, false)).toBe(true)
  expect(wallFacingNegative(2 * e, true)).toBe(false)
})

test('legacy wall extensions preserve the viewer-to-nodes dependency boundary', async () => {
  const root = new URL('../../', import.meta.url).pathname
  for (const file of new Bun.Glob('**/*.{ts,tsx}').scanSync(root)) {
    const source = await Bun.file(`${root}${file}`).text()
    expect(source).not.toMatch(/(?:from|import\s*\()\s*['"]@pascal-app\/nodes/)
  }
  for (const file of ['wall-cutout-cache.ts', 'wall-rebuild-notifications.ts']) {
    const source = await Bun.file(new URL(file, import.meta.url)).text()
    expect(source.split('\n')[0]).toContain('New kind-specific modules belong in nodes')
    expect(source.split('\n')[1]).toContain('viewer-owned')
  }
})

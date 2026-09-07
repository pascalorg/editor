import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test'
import {
  MaterialPresetPayloadSchema,
  registerLibraryMaterials,
  SceneMaterial,
  sceneRegistry,
  unregisterLibraryMaterials,
  useScene,
  WallNode,
} from '@pascal-app/core'
import { BoxGeometry, Group, type Material, Mesh, PerspectiveCamera, Texture, Vector3 } from 'three'
import useViewer from '../../store/use-viewer'
import { getWallHideState } from './wall-cutout'
import {
  sameMaterialArray,
  WALL_FACING_HYSTERESIS,
  WallCutoutCache,
  wallFacingNegative,
} from './wall-cutout-cache'
import { getMaterialsForWall } from './wall-materials'
import {
  drainRebuiltWalls,
  notifyWallRebuilt,
  subscribeWallRebuilds,
} from './wall-rebuild-notifications'

const sceneBefore = useScene.getState()
const viewerBefore = useViewer.getState()
let cache: WallCutoutCache
let camera: PerspectiveCamera
let unsubscribe: () => void

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
  useViewer.setState({
    wallMode: 'cutaway',
    shading: 'solid',
    textures: false,
    colorPreset: 'clay',
    selection: { ...viewerBefore.selection, selectedIds: [] },
    previewSelectedIds: [],
    hoveredId: null,
    hoverHighlightMode: 'default',
  })
  cache = new WallCutoutCache()
  camera = new PerspectiveCamera()
  unsubscribe = subscribeWallRebuilds((id) => cache.rebuilt.add(id))
})

afterEach(() => {
  unsubscribe()
  drainRebuiltWalls(new Set())
  sceneRegistry.clear()
  useScene.setState(sceneBefore)
  useViewer.setState(viewerBefore)
})

describe('WallCutoutCache', () => {
  test('camera orbit in full height never iterates cached walls or reads camera direction', () => {
    useViewer.setState({ wallMode: 'up' })
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
    parent.add(mesh)
    cache.update(camera, 1)
    parent.rotation.y = Math.PI
    useScene.setState({ nodes: { ...useScene.getState().nodes } })
    cache.update(camera, 1.01)
    expect(mesh.userData.wallHidden).toBe(false)
    useScene.setState({
      nodes: { [node.id]: { ...node, frontSide: 'interior', backSide: 'interior' } },
    })
    cache.update(camera, 1.02)
    expect(mesh.userData.wallHidden).toBe(true)
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
      useViewer.setState({ wallMode: mode })
      cache.update(camera, 1.01)
      expect(mesh.userData.wallHidden).toBe(hidden)
      expect(cache.walls.values().next().value!.variantKey).toBe(
        mode === 'translucent' ? 'translucent' : hidden ? 'invisible' : 'visible',
      )
    }
  })

  test('appearance and highlight refreshes do not reassign an already-current material array', () => {
    const { node, mesh } = addWall()
    useViewer.setState({ wallMode: 'up' })
    const writes = trackWrites(mesh)
    cache.update(camera, 1)
    useViewer.setState({ hoveredId: node.id })
    cache.update(camera, 1.01)
    expect(writes.material).toBe(1)
    useViewer.setState({ selection: { ...viewerBefore.selection, selectedIds: [node.id] } })
    cache.update(camera, 1.02)
    expect(writes.material).toBe(2)
    useViewer.setState({ previewSelectedIds: [node.id] })
    cache.update(camera, 1.03)
    expect(writes.material).toBe(2)
    expect(writes.stamp).toBe(1)
    useViewer.setState({ hoverHighlightMode: 'delete' })
    cache.update(camera, 1.04)
    expect(cache.walls.get(node.id)?.variantKey).toBe('delete-visible')
    expect(writes.material).toBe(3)
  })

  test('all appearance inputs refresh in full height without camera movement', () => {
    const { node, mesh } = addWall()
    useViewer.setState({ wallMode: 'up' })
    cache.update(camera, 1)
    const patches = [
      { shading: 'rendered' as const },
      { colorPreset: 'white' as const },
      { sceneTheme: 'dark' },
      { textures: true },
    ]
    for (const patch of patches) {
      useViewer.setState(patch)
      cache.update(camera, 1.01)
      const v = useViewer.getState()
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
    useViewer.setState({ wallMode: 'up', textures: true })
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

  test('selected wall clones pick up a late texture with a stationary full-height camera', () => {
    const { node, mesh } = addWall()
    useViewer.setState({
      wallMode: 'up',
      selection: { ...viewerBefore.selection, selectedIds: [node.id] },
    })
    cache.update(camera, 1)
    const viewer = useViewer.getState()
    const source = getMaterialsForWall(
      node,
      viewer.shading,
      viewer.textures,
      viewer.colorPreset,
      viewer.sceneTheme,
    ).visible[1]! as Material & { map: Texture | null }
    const originalMap = source.map
    const texture = new Texture()
    try {
      source.map = texture
      cache.update(camera, 1.01)
      expect(
        ((mesh.material as Material[])[1] as Material & { map: Texture }).map === texture,
      ).toBe(true)
    } finally {
      source.map = originalMap
      texture.dispose()
    }
  })

  test('face-band changes remove whole-wall selection highlighting immediately', () => {
    const { node } = addWall()
    useViewer.setState({
      wallMode: 'up',
      selection: { ...viewerBefore.selection, selectedIds: [node.id] },
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
          useViewer.setState({ wallMode: mode })
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

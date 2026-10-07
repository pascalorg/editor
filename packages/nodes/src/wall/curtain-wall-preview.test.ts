import { afterEach, expect, test } from 'bun:test'
import {
  CurtainWallConfig,
  sceneRegistry,
  useLiveNodeOverrides,
  useScene,
  WallNode,
} from '@pascal-app/core'
import { WallCutoutCache, type WallCutoutViewerState } from '@pascal-app/viewer'
import { Mesh, PerspectiveCamera } from 'three'
import { getCurtainAwareWallMaterials } from './curtain-wall-materials'

const initial = useScene.getState()
afterEach(() => {
  useLiveNodeOverrides.getState().clearAll()
  sceneRegistry.clear()
  useScene.setState(initial)
})

test('selected curtain glass previews and cancels without changing the document or other walls', () => {
  const wall = WallNode.parse({ start: [0, 0], end: [6, 0], wallType: 'curtain', curtainWall: {} })
  const other = WallNode.parse({ start: [0, 4], end: [6, 4], wallType: 'curtain' })
  useScene.setState({ nodes: { [wall.id]: wall, [other.id]: other }, materials: {} })
  const mesh = new Mesh(),
    otherMesh = new Mesh()
  for (const [node, object] of [
    [wall, mesh],
    [other, otherMesh],
  ] as const) {
    sceneRegistry.nodes.set(node.id, object)
    sceneRegistry.byType.wall!.add(node.id)
  }
  const viewer: WallCutoutViewerState = {
    wallMode: 'up',
    shading: 'solid',
    textures: true,
    colorPreset: 'clay',
    sceneTheme: 'studio',
    selection: { buildingId: null, levelId: null, zoneId: null, selectedIds: [wall.id] },
    previewSelectedIds: [],
    hoveredId: null,
    hoverHighlightMode: 'default',
  }
  const cache = new WallCutoutCache({ getState: () => viewer }, getCurtainAwareWallMaterials)
  const camera = new PerspectiveCamera()
  cache.update(camera, 1)
  const otherMaterial = otherMesh.material
  const opacity = () => (Array.isArray(mesh.material) ? mesh.material[1]!.opacity : -1)
  expect(opacity()).toBe(0.3)
  useLiveNodeOverrides
    .getState()
    .set(wall.id, { curtainWall: CurtainWallConfig.parse({ glassOpacity: 0.8 }) })
  cache.update(camera, 2)
  expect(opacity()).toBe(0.8)
  expect(useScene.getState().nodes[wall.id]).toBe(wall)
  expect(otherMesh.material).toBe(otherMaterial)
  useLiveNodeOverrides.getState().clear(wall.id)
  cache.update(camera, 3)
  expect(opacity()).toBe(0.3)
  expect(otherMesh.material).toBe(otherMaterial)
})

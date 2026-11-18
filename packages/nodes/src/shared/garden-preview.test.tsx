import { afterEach, beforeEach, expect, test } from 'bun:test'
import {
  BuildingNode,
  clearSceneHistory,
  createSceneApi,
  FLAT_GROUND_Y,
  LevelNode,
  SiteNode,
  SlabNode,
  useScene,
} from '@pascal-app/core'
import {
  EDITOR_LAYER,
  RegistryToolProvider,
  sceneLayout,
  useEditor,
  useInteractionScope,
} from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { act, create } from '@react-three/test-renderer'
import { Window as TestWindow } from 'happy-dom'
import type { ComponentType } from 'react'
import {
  type InstancedBufferGeometry,
  type Intersection,
  type LineBasicMaterial,
  type Mesh,
  NormalBlending,
  type Object3D,
  PerspectiveCamera,
  Raycaster,
  Scene,
  Vector3,
} from 'three'
import { WebGPURenderer } from 'three/webgpu'
import { useHedgeDraft } from '../hedge/draft'
import { builtinPlugin } from '../index'
import { lawnBrushColor, useLawnAuthoring } from '../lawn/brush'
import { useLawnDraft } from '../lawn/draft'
import { usePlantingDraft } from '../planting/draft'

type PreviewMesh = Mesh<InstancedBufferGeometry>
let restore: () => Promise<void> = async () => {}

beforeEach(() => {
  const dom = new TestWindow()
  const globals = {
    window: dom,
    document: dom.document,
    navigator: dom.navigator,
    Element: dom.Element,
    HTMLElement: dom.HTMLElement,
    HTMLCanvasElement: dom.HTMLCanvasElement,
    Node: dom.Node,
    Event: dom.Event,
    PointerEvent: dom.PointerEvent,
    requestAnimationFrame: () => 0,
    cancelAnimationFrame: () => {},
    IS_REACT_ACT_ENVIRONMENT: true,
  }
  const descriptors = [
    ...Object.keys(globals),
    'WebGLRenderingContext',
    'WebGL2RenderingContext',
  ].map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const)
  const stores = [useScene, useEditor, useViewer, useInteractionScope, useLawnAuthoring] as const
  const saved = stores.map((store) => store.getState())
  for (const [name, value] of Object.entries(globals))
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value })
  restore = async () => {
    await dom.happyDOM.abort()
    for (const [index, store] of stores.entries())
      (store.setState as (state: unknown, replace: true) => void)(saved[index], true)
    clearSceneHistory()
    for (const [name, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor)
      else Reflect.deleteProperty(globalThis, name)
    }
  }
})
afterEach(() => restore())

type GardenToolKind = 'hedge' | 'planting' | 'lawn'

function seedGardenScene(kind: GardenToolKind, brush: boolean) {
  const site = SiteNode.parse({
    id: 'site_preview',
    children: ['building_preview', 'slab_preview'],
  })
  const building = BuildingNode.parse({
    id: 'building_preview',
    parentId: site.id,
    children: ['level_preview'],
    position: [10, 2, -3],
    rotation: [0, Math.PI / 2, 0],
  })
  const level = LevelNode.parse({ id: 'level_preview', parentId: building.id })
  const slab = SlabNode.parse({
    id: 'slab_preview',
    parentId: site.id,
    elevation: 0.7,
    thickness: 0.2,
    polygon: [
      [-10, -10],
      [10, -10],
      [10, 10],
      [-10, 10],
    ],
  })
  useScene.setState({
    nodes: { [site.id]: site, [building.id]: building, [level.id]: level, [slab.id]: slab },
    rootNodeIds: [site.id],
  })
  useEditor.setState({
    mode: 'build',
    tool: kind,
    workspaceMode: 'edit',
    viewLayouts: { edit: sceneLayout('3d') },
  })
  useViewer.getState().setSelection({ buildingId: building.id, levelId: level.id })
  useLawnAuthoring.setState({ mode: brush ? 'brush' : 'area', radiusM: 2, effect: 'bare' })
  return { building, level }
}

async function mountGardenTool(kind: GardenToolKind, brush = false) {
  const { building, level } = seedGardenScene(kind, brush)
  const definition = builtinPlugin.nodes?.find((entry) => entry.kind === kind)
  if (!definition?.tool) throw new Error(`Missing ${kind} tool`)
  const { default: Tool } = (await definition.tool()) as { default: ComponentType }
  const camera = new PerspectiveCamera(60, 1, 0.1, 1000)
  camera.position.set(0, 10, 10)
  camera.lookAt(0, 0, 0)
  camera.updateMatrixWorld(true)
  let canvas: HTMLCanvasElement | undefined
  const renderer = await create(
    <group position={building.position} rotation={building.rotation}>
      <RegistryToolProvider
        value={{
          activeLevelId: level.id,
          sceneApi: createSceneApi(useScene),
          isCameraDragging: () => false,
          selectNode: () => {},
          unit: 'metric',
        }}
      >
        <Tool />
      </RegistryToolProvider>
    </group>,
    {
      camera,
      width: 200,
      height: 200,
      beforeReturn: (element) => {
        canvas = element
        element.getBoundingClientRect = () => new window.DOMRect(0, 0, 200, 200)
      },
    },
  )
  return { renderer, camera, canvas }
}

function previewMeshes(root: Object3D) {
  const meshes: PreviewMesh[] = []
  root.traverse((object) => {
    if ('geometry' in object && (object as Mesh).geometry.getAttribute('instanceStart'))
      meshes.push(object as PreviewMesh)
  })
  expect(meshes.length).toBeGreaterThan(0)
  return meshes
}

// This is the renderer's actual material conversion seam, without initializing a GPU.
function expectDrawablePreview(mesh: PreviewMesh, width: number, segments: number) {
  const renderer = new WebGPURenderer()
  const material = mesh.material
  if (Array.isArray(material)) throw new Error('Expected one preview material')
  expect(renderer.library.fromMaterial(material)).not.toBeNull()
  expect(Number.isFinite(mesh.geometry.instanceCount)).toBe(true)
  expect(mesh.geometry.instanceCount).toBe(segments)
  expect(mesh.geometry.getAttribute('instanceStart').count).toBe(segments)
  expect(material).toMatchObject({
    linewidth: width,
    worldUnits: false,
    depthTest: false,
    depthWrite: true,
  })
  expect(mesh.layers.mask).toBe(1 << EDITOR_LAYER)
  const hits: Intersection[] = []
  mesh.raycast(new Raycaster(), hits)
  expect(hits).toEqual([])
  expect(mesh.userData.pascalExport ?? mesh.parent?.userData.pascalExport).toBe('strip')
}

function expectSelfContainedPreviewShader(mesh: PreviewMesh) {
  const renderer = new WebGPURenderer()
  renderer.hasFeature = () => false
  renderer.backend.capabilities.getUniformBufferLimit = () => 65536
  // Headless compilation does not initialize shared GPU bind groups (same seam as hedge tests).
  ;(renderer as unknown as { _bindings?: unknown })._bindings = undefined
  const builder = renderer.backend.createNodeBuilder(mesh, renderer)
  builder.camera = new PerspectiveCamera()
  builder.scene = new Scene()
  builder.clippingContext = null
  builder.build()
  expect(builder.vertexShader.length).toBeGreaterThan(0)
  expect(builder.fragmentShader.length).toBeGreaterThan(0)
  // The editor composites its own overlay texture; a preview must not capture an opaque framebuffer.
  expect(
    builder.updateBeforeNodes.some(
      (node) => 'isOutputTextureNode' in node && node.isOutputTextureNode,
    ),
  ).toBe(false)
  expect(mesh.material).toMatchObject({ blending: NormalBlending })
}

for (const [kind, draft, color, closed] of [
  ['hedge', useHedgeDraft, '#3f8f3a', false],
  ['planting', usePlantingDraft, '#3f8f3a', true],
  ['lawn', useLawnDraft, '#617c36', true],
] as const) {
  test(`${kind} draft submits finite screen-space outlines accepted by WebGPURenderer`, async () => {
    const { renderer } = await mountGardenTool(kind)
    let materialDisposals = 0
    try {
      await act(async () =>
        draft.setState({
          points: [
            [1, 2],
            [4, 2],
            [4, 4],
          ],
          hover: null,
          error: null,
        }),
      )
      const meshes = previewMeshes(renderer.scene.instance)
      expect(meshes).toHaveLength(1)
      const mesh = meshes[0]
      if (!mesh || Array.isArray(mesh.material)) throw new Error('Missing draft outline')
      expectDrawablePreview(mesh, 3, closed ? 3 : 2)
      expect((mesh.material as LineBasicMaterial).color.getHexString()).toBe(color.slice(1))
      renderer.scene.instance.updateMatrixWorld(true)
      const starts = mesh.geometry.getAttribute('instanceStart')
      const start = new Vector3().fromBufferAttribute(starts, 0).applyMatrix4(mesh.matrixWorld)
      expect(start.x).toBe(1)
      expect(start.y).toBeCloseTo(kind === 'lawn' ? 0.735 : 0.75, 6)
      expect(start.z).toBe(2)
      let geometryDisposals = 0
      mesh.geometry.addEventListener('dispose', () => geometryDisposals++)
      mesh.material.addEventListener('dispose', () => materialDisposals++)
      await act(async () =>
        draft.setState({
          points: [
            [1, 2],
            [5, 2],
          ],
          hover: null,
        }),
      )
      expect(geometryDisposals).toBe(1)
      expect(materialDisposals).toBe(0)
    } finally {
      await act(async () => renderer.unmount())
    }
    expect(materialDisposals).toBe(1)
  })
}

test('lawn brush submits four finite translucent 2px rings on the ground', async () => {
  const { renderer, camera, canvas } = await mountGardenTool('lawn', true)
  try {
    if (!canvas) throw new Error('Missing lawn canvas')
    const ndc = new Vector3(0, FLAT_GROUND_Y, 0).project(camera)
    await act(async () => {
      canvas.dispatchEvent(
        new PointerEvent('pointermove', {
          clientX: (ndc.x + 1) * 100,
          clientY: (1 - ndc.y) * 100,
          button: 0,
          bubbles: true,
        }),
      )
    })
    const meshes = previewMeshes(renderer.scene.instance)
    expect(meshes).toHaveLength(4)
    for (const [index, mesh] of meshes.entries()) {
      expectDrawablePreview(mesh, 2, 64)
      if (index === 0) expectSelfContainedPreviewShader(mesh)
      const fraction = (index + 1) / 4
      expect(mesh.material).toMatchObject({
        transparent: true,
        opacity: (1 - fraction * 0.7) * 0.6,
      })
      if (Array.isArray(mesh.material)) throw new Error('Expected one ring material')
      expect((mesh.material as LineBasicMaterial).color.getHexString()).toBe(
        lawnBrushColor.bare.slice(1),
      )
      const starts = mesh.geometry.getAttribute('instanceStart')
      expect(starts.getY(0)).toBeCloseTo(0.735, 6)
      const ends = mesh.geometry.getAttribute('instanceEnd')
      expect(ends.getX(63)).toBeCloseTo(starts.getX(0), 6)
      expect(ends.getZ(63)).toBeCloseTo(starts.getZ(0), 6)
      expect(Math.hypot(starts.getX(0), starts.getZ(0))).toBeCloseTo(2 * fraction, 5)
    }
  } finally {
    await act(async () => renderer.unmount())
  }
})

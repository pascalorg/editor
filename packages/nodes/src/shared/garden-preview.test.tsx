import { afterEach, beforeEach, expect, test } from 'bun:test'
import {
  type AnyNode,
  BuildingNode,
  clearSceneHistory,
  createSceneApi,
  emitter,
  FLAT_GROUND_Y,
  type GridEvent,
  LevelNode,
  nodeRegistry,
  registerNode,
  SiteNode,
  SlabNode,
  useScene,
} from '@pascal-app/core'
import {
  EDITOR_LAYER,
  RegistryToolProvider,
  sceneLayout,
  TOOL_DRAFT_FILL_OPACITY,
  TOOL_INVALID_COLOR,
  TOOL_PREVIEW_COLOR,
  useEditor,
  useInteractionScope,
} from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { act, create } from '@react-three/test-renderer'
import { Window as TestWindow } from 'happy-dom'
import type { ComponentType } from 'react'
import {
  type CircleGeometry,
  type InstancedBufferGeometry,
  type Intersection,
  type LineBasicMaterial,
  type Mesh,
  type MeshBasicMaterial,
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

type GardenToolKind = 'tree' | 'rock' | 'hedge' | 'planting' | 'lawn'

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

/** `onPage` puts the canvas in the document, so the tool's in-scene HTML (its cursor bubble) mounts. */
async function mountGardenTool(kind: GardenToolKind, brush = false, onPage = false) {
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
        if (onPage) document.body.appendChild(element)
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
  ['hedge', useHedgeDraft, TOOL_PREVIEW_COLOR, false],
  ['planting', usePlantingDraft, TOOL_PREVIEW_COLOR, true],
  ['lawn', useLawnDraft, TOOL_PREVIEW_COLOR, true],
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

// ---- What a person sees while placing by hand: the editor's own cursor and draft look.

/** The ground dots of the editor's cursor (the wall tool's target) that are on screen. */
function groundDots(root: Object3D) {
  root.updateMatrixWorld(true)
  const dots: { at: Vector3; color: string }[] = []
  root.traverse((object) => {
    const mesh = object as Mesh<CircleGeometry, MeshBasicMaterial>
    if (mesh.geometry?.type !== 'CircleGeometry' || mesh.geometry.parameters.radius !== 0.06) return
    for (let node: Object3D | null = mesh; node; node = node.parent) if (!node.visible) return
    dots.push({
      at: mesh.getWorldPosition(new Vector3()),
      color: `#${mesh.material.color.getHexString()}`,
    })
  })
  return dots
}

/** Put the pointer over a ground point the way each tool hears it. Alt keeps the raw point. */
function pointAt(
  kind: GardenToolKind,
  canvas: HTMLCanvasElement,
  camera: PerspectiveCamera,
  [x, z]: [number, number],
) {
  if (kind === 'lawn') {
    const ndc = new Vector3(x, FLAT_GROUND_Y, z).project(camera)
    canvas.dispatchEvent(
      new PointerEvent('pointermove', {
        clientX: (ndc.x + 1) * 100,
        clientY: (1 - ndc.y) * 100,
        button: 0,
        altKey: true,
        bubbles: true,
      }),
    )
    return
  }
  emitter.emit('grid:move', {
    position: [x, 0, z],
    localPosition: [x, 0, z],
    nativeEvent: { target: canvas, buttons: 0, altKey: true },
  } as unknown as GridEvent)
}

for (const [kind, brush, label] of [
  ['tree', false, 'Tree'],
  ['rock', false, 'Rock'],
  ['hedge', false, 'Hedge'],
  ['planting', false, 'Planting bed'],
  ['lawn', false, 'Lawn'],
  ['lawn', true, 'Lawn'],
] as const) {
  // Every garden kind's icon is a picture served by the app, so the bubble can be mounted here.
  const withBubble = true
  test(`${kind}${brush ? ' brush' : ''} in hand: the editor's target follows the pointer on the ground, under the tool's own picture`, async () => {
    // The bubble reads the kind's icon and name from the registry.
    const restoreRegistry = nodeRegistry._snapshot()
    const definition = builtinPlugin.nodes?.find((entry) => entry.kind === kind)
    if (withBubble && definition && !nodeRegistry.has(kind)) registerNode(definition)
    const { renderer, camera, canvas } = await mountGardenTool(kind, brush, withBubble)
    try {
      if (!canvas) throw new Error('Missing canvas')
      // Nothing is shown before the pointer reaches the ground.
      expect(groundDots(renderer.scene.instance)).toEqual([])
      for (const point of [
        [2, 1],
        [-3, 4],
      ] as [number, number][]) {
        await act(async () => pointAt(kind, canvas, camera, point))
        const dots = groundDots(renderer.scene.instance)
        expect(dots).toHaveLength(1)
        expect(dots[0]?.color).toBe(TOOL_PREVIEW_COLOR)
        expect(dots[0]?.at.x).toBeCloseTo(point[0], 3)
        // The slab under the pointer is the ground here: its top, not the Site datum.
        expect(dots[0]?.at.y).toBeCloseTo(0.7, 6)
        expect(dots[0]?.at.z).toBeCloseTo(point[1], 3)
      }
      // The bubble holds the kind's picture, as the wall's holds its art: named for the tool.
      const picture = document.querySelector('img')
      expect(picture?.getAttribute('alt')).toBe(label)
      expect(picture?.getAttribute('src')).toBe(`/icons/garden-${kind}.webp`)
    } finally {
      await act(async () => renderer.unmount())
      restoreRegistry()
    }
  })
}

for (const [kind, draft] of [
  ['planting', usePlantingDraft],
  ['lawn', useLawnDraft],
] as const) {
  test(`${kind} area being drawn is filled and marks every placed point, like a slab draft`, async () => {
    const { renderer } = await mountGardenTool(kind)
    try {
      await act(async () =>
        draft.setState({
          points: [
            [1, 2],
            [4, 2],
            [4, 4],
          ],
          hover: [1, 4],
          error: null,
        }),
      )
      // Three placed points and the target under the pointer.
      const dots = groundDots(renderer.scene.instance)
      expect(dots).toHaveLength(4)
      expect(new Set(dots.map((dot) => dot.color))).toEqual(new Set([TOOL_PREVIEW_COLOR]))
      const fills: Mesh<InstancedBufferGeometry, MeshBasicMaterial>[] = []
      renderer.scene.instance.traverse((object) => {
        const mesh = object as Mesh<InstancedBufferGeometry, MeshBasicMaterial>
        if (mesh.isMesh && mesh.material?.opacity === TOOL_DRAFT_FILL_OPACITY) fills.push(mesh)
      })
      expect(fills).toHaveLength(1)
      const fill = fills[0]
      if (!fill) throw new Error('Missing area fill')
      expect(`#${fill.material.color.getHexString()}`).toBe(TOOL_PREVIEW_COLOR)
      // A quadrilateral: two triangles over the four outline points, on the editor's overlay.
      expect(fill.geometry.getIndex()?.count).toBe(6)
      expect(fill.geometry.getAttribute('position').count).toBe(4)
      expect(fill.layers.mask).toBe(1 << EDITOR_LAYER)
      expect(fill.userData.pascalExport).toBe('strip')
      const outline = previewMeshes(renderer.scene.instance)
      expect(outline).toHaveLength(1)
      expect(outline[0]?.geometry.instanceCount).toBe(4)
    } finally {
      await act(async () => renderer.unmount())
    }
  })
}

for (const [kind, draft] of [
  ['hedge', useHedgeDraft],
  ['planting', usePlantingDraft],
  ['lawn', useLawnDraft],
] as const) {
  test(`${kind} draft the tool refuses turns the editor's refusal red and loses its fill`, async () => {
    const { renderer } = await mountGardenTool(kind)
    try {
      await act(async () =>
        draft.setState({
          points: [
            [1, 2],
            [4, 2],
            [4, 4],
          ],
          hover: null,
          error: 'Refused',
        }),
      )
      const outline = previewMeshes(renderer.scene.instance)
      expect(outline).toHaveLength(1)
      const material = outline[0]?.material as LineBasicMaterial
      expect(`#${material.color.getHexString()}`).toBe(TOOL_INVALID_COLOR)
      let fills = 0
      renderer.scene.instance.traverse((object) => {
        const mesh = object as Mesh<InstancedBufferGeometry, MeshBasicMaterial>
        if (mesh.isMesh && mesh.material?.opacity === TOOL_DRAFT_FILL_OPACITY) fills++
      })
      expect(fills).toBe(0)
    } finally {
      await act(async () => renderer.unmount())
    }
  })
}

// ---- The target and the placed object are under the pointer, whatever plane the grid measures on.

for (const kind of ['tree', 'rock', 'hedge', 'planting'] as const) {
  test(`${kind}: from its first event the target stands under the pointer's ray, not where a floor plane above the garden reports`, async () => {
    const { renderer, camera, canvas } = await mountGardenTool(kind)
    try {
      if (!canvas) throw new Error('Missing canvas')
      // Nothing is drawn while the pointer has not reached the canvas.
      expect(groundDots(renderer.scene.instance)).toEqual([])
      // The pointer is on the ground point (2, 1): here the top of the Site's slab, 0.7 m up.
      const ndc = new Vector3(2, 0.7, 1).project(camera)
      const pointer = {
        target: canvas,
        clientX: (ndc.x + 1) * 100,
        clientY: (1 - ndc.y) * 100,
        buttons: 0,
        altKey: true,
      }
      // The editor's grid reports the same ray on a floor 3 m above: a point metres short of it.
      const eye = camera.position
      const along = new Vector3(2, 0.7, 1).sub(eye)
      const short = eye.clone().addScaledVector(along, (3.7 - eye.y) / along.y)
      const event = {
        position: [short.x, 3.7, short.z],
        localPosition: [short.x, 3.7, short.z],
        nativeEvent: pointer,
      } as unknown as GridEvent
      expect(Math.hypot(short.x - 2, short.z - 1)).toBeGreaterThan(2)
      await act(async () => emitter.emit('grid:move', event))
      const dots = groundDots(renderer.scene.instance)
      expect(dots).toHaveLength(1)
      expect(dots[0]?.at.x).toBeCloseTo(2, 3)
      expect(dots[0]?.at.y).toBeCloseTo(0.7, 6)
      expect(dots[0]?.at.z).toBeCloseTo(1, 3)
      if (kind !== 'tree' && kind !== 'rock') return
      // A click there sets the object at that same point.
      await act(async () => emitter.emit('grid:click', event))
      const placed = Object.values(useScene.getState().nodes).find((node) => node.type === kind)
      if (!placed) throw new Error(`No ${kind} was placed`)
      const at =
        placed.type === 'tree'
          ? [placed.position[0], placed.position[2]]
          : placed.type === 'rock'
            ? [
                placed.polygon.reduce((sum, corner) => sum + corner[0], 0) / placed.polygon.length,
                placed.polygon.reduce((sum, corner) => sum + corner[1], 0) / placed.polygon.length,
              ]
            : [Number.NaN, Number.NaN]
      // The rock's footprint is an organic outline around the point: its centre is within a hand's width.
      expect(at[0]).toBeCloseTo(2, kind === 'tree' ? 3 : 0)
      expect(at[1]).toBeCloseTo(1, kind === 'tree' ? 3 : 0)
    } finally {
      await act(async () => renderer.unmount())
    }
  })
}

// ---- Finishing a draft, and what the card says about it.

const TRIANGLE: [number, number][] = [
  [1, 2],
  [4, 2],
  [4, 4],
]
const nodesOf = (kind: GardenToolKind) =>
  Object.values(useScene.getState().nodes).filter((node) => node.type === kind)

/** Bare ground: the seeded scene paves the whole Site, where nothing can be planted. */
function liftThePaving() {
  const { slab_preview: _paving, ...nodes } = useScene.getState().nodes as Record<string, AnyNode>
  const site = nodes.site_preview as AnyNode & { children: string[] }
  useScene.setState({
    nodes: {
      ...nodes,
      [site.id]: { ...site, children: site.children.filter((id) => id !== 'slab_preview') },
    } as typeof useScene extends { getState: () => { nodes: infer N } } ? N : never,
  })
}

for (const [kind, draft, least] of [
  ['hedge', useHedgeDraft, 2],
  ['planting', usePlantingDraft, 3],
  ['lawn', useLawnDraft, 3],
] as const) {
  test(`${kind}: the card lists Enter only once there is something to finish (${least} points)`, async () => {
    const definition = builtinPlugin.nodes?.find((entry) => entry.kind === kind)
    const enter = definition?.toolHints?.find((hint) => hint.key === 'Enter')
    expect(enter?.minDraftVertices).toBe(least)
    const { renderer } = await mountGardenTool(kind)
    try {
      expect(useEditor.getState().draftVertexCount).toBe(0)
      await act(async () => draft.setState({ points: TRIANGLE.slice(0, least - 1), hover: null }))
      expect(useEditor.getState().draftVertexCount).toBe(least - 1)
      await act(async () => draft.setState({ points: TRIANGLE.slice(0, least), hover: null }))
      expect(useEditor.getState().draftVertexCount).toBe(least)
    } finally {
      await act(async () => renderer.unmount())
    }
    expect(useEditor.getState().draftVertexCount).toBe(0)
  })
}

test('planting bed: a double-click plants the outline, and does nothing while it has fewer than three points', async () => {
  const { renderer, canvas } = await mountGardenTool('planting')
  try {
    await act(async () => liftThePaving())
    const doubleClick = () =>
      act(async () =>
        emitter.emit('grid:double-click', {
          position: [4, 0, 4],
          localPosition: [4, 0, 4],
          nativeEvent: { target: canvas, buttons: 0, altKey: true },
        } as unknown as GridEvent),
      )
    await act(async () => usePlantingDraft.setState({ points: TRIANGLE.slice(0, 2), hover: null }))
    await doubleClick()
    expect(nodesOf('planting')).toHaveLength(0)
    expect(usePlantingDraft.getState().error).toBeNull()
    expect(usePlantingDraft.getState().points).toHaveLength(2)
    await act(async () => usePlantingDraft.setState({ points: TRIANGLE, hover: null }))
    await doubleClick()
    expect(nodesOf('planting')).toHaveLength(1)
    expect(usePlantingDraft.getState().points).toEqual([])
  } finally {
    await act(async () => renderer.unmount())
  }
})

test('lawn: a double-click lays the outline, and does nothing while it has fewer than three points', async () => {
  const { renderer, camera, canvas } = await mountGardenTool('lawn')
  try {
    if (!canvas) throw new Error('Missing canvas')
    await act(async () => liftThePaving())
    const ndc = new Vector3(4, FLAT_GROUND_Y, 4).project(camera)
    const doubleClick = () =>
      act(async () => {
        canvas.dispatchEvent(
          new PointerEvent('dblclick', {
            clientX: (ndc.x + 1) * 100,
            clientY: (1 - ndc.y) * 100,
            button: 0,
            bubbles: true,
          }),
        )
      })
    await act(async () => useLawnDraft.setState({ points: TRIANGLE.slice(0, 2), hover: null }))
    await doubleClick()
    expect(nodesOf('lawn')).toHaveLength(0)
    expect(useLawnDraft.getState().error).toBeNull()
    await act(async () => useLawnDraft.setState({ points: TRIANGLE, hover: null }))
    await doubleClick()
    expect(nodesOf('lawn')).toHaveLength(1)
    expect(useLawnDraft.getState().points).toEqual([])
  } finally {
    await act(async () => renderer.unmount())
  }
})

test('hedge: a double-click plants the run, its second click landing on the point the first one set', async () => {
  const { renderer, canvas } = await mountGardenTool('hedge')
  try {
    const clickAt = (x: number, z: number) =>
      act(async () =>
        emitter.emit('grid:click', {
          position: [x, 0, z],
          localPosition: [x, 0, z],
          nativeEvent: { target: canvas, buttons: 0, altKey: true },
        } as unknown as GridEvent),
      )
    await clickAt(1, 2)
    await clickAt(4, 2)
    expect(nodesOf('hedge')).toHaveLength(0)
    await clickAt(4, 2)
    expect(nodesOf('hedge')).toHaveLength(1)
    expect(useHedgeDraft.getState().points).toEqual([])
  } finally {
    await act(async () => renderer.unmount())
  }
})

test("hedge being drawn shows the volume it will take: its width and height along every segment, in the editor's preview colour", async () => {
  const { renderer } = await mountGardenTool('hedge')
  try {
    const volumes = () => {
      const found: Mesh<InstancedBufferGeometry, MeshBasicMaterial>[] = []
      renderer.scene.instance.traverse((object) => {
        if (object.userData.gardenRunVolume)
          found.push(object as Mesh<InstancedBufferGeometry, MeshBasicMaterial>)
      })
      return found
    }
    expect(volumes()).toEqual([])
    await act(async () =>
      useHedgeDraft.setState({
        points: [
          [1, 2],
          [4, 2],
        ],
        hover: [4, 6],
        error: null,
      }),
    )
    // Two segments: 3 m then 4 m, each 1.2 m high and 0.7 m wide (the schema's own hedge).
    expect(volumes().map((mesh) => mesh.scale.toArray())).toEqual([
      [3, 1.2, 0.7],
      [4, 1.2, 0.7],
    ])
    for (const mesh of volumes()) {
      expect(`#${mesh.material.color.getHexString()}`).toBe(TOOL_PREVIEW_COLOR)
      expect(mesh.material.opacity).toBe(0.5)
      expect(mesh.layers.mask).toBe(1 << EDITOR_LAYER)
      // It stands on the ground: here the slab's top.
      expect(mesh.position.y).toBeCloseTo(0.7 + 0.05 + 0.6, 6)
    }
    await act(async () => useHedgeDraft.setState({ error: 'Refused' }))
    expect(new Set(volumes().map((mesh) => `#${mesh.material.color.getHexString()}`))).toEqual(
      new Set([TOOL_INVALID_COLOR]),
    )
  } finally {
    await act(async () => renderer.unmount())
  }
})

// ---- A ghost of the object, before the click.

for (const kind of ['tree', 'rock'] as const) {
  test(`${kind}: a translucent ghost of what the click will set follows the pointer, built once, and goes once it is set`, async () => {
    const { renderer, camera, canvas } = await mountGardenTool(kind)
    try {
      if (!canvas) throw new Error('Missing canvas')
      const holders = () => {
        const found: Object3D[] = []
        renderer.scene.instance.traverse((object) => {
          if (object.userData.gardenGhost) found.push(object)
        })
        return found
      }
      // Built when the tool is taken, shown only once the pointer is on the ground.
      expect(holders()).toHaveLength(1)
      const holder = holders()[0]
      if (!holder) throw new Error('Missing ghost')
      expect(holder.visible).toBe(false)
      await act(async () => pointAt(kind, canvas, camera, [2, 1]))
      expect(holder.visible).toBe(true)
      expect(holder.position.toArray()).toEqual([2, 0.7, 1])
      const body = holder.children[0]
      const meshes: Mesh<InstancedBufferGeometry, MeshBasicMaterial>[] = []
      holder.traverse((object) => {
        if ((object as Mesh).isMesh)
          meshes.push(object as Mesh<InstancedBufferGeometry, MeshBasicMaterial>)
      })
      expect(meshes.length).toBeGreaterThan(0)
      for (const mesh of meshes) {
        expect(mesh.material.transparent).toBe(true)
        expect(mesh.material.opacity).toBeLessThanOrEqual(0.5)
        expect(mesh.geometry.getAttribute('position').count).toBeGreaterThan(0)
      }
      // Moving the pointer moves the same object: nothing is rebuilt per pointer event.
      await act(async () => pointAt(kind, canvas, camera, [-3, 4]))
      expect(holder.position.toArray()).toEqual([-3, 0.7, 4])
      expect(holder.children[0]).toBe(body)
      await act(async () =>
        emitter.emit('grid:click', {
          position: [-3, 0, 4],
          localPosition: [-3, 0, 4],
          nativeEvent: { target: canvas, buttons: 0, altKey: true },
        } as unknown as GridEvent),
      )
      expect(nodesOf(kind)).toHaveLength(1)
      expect(holder.visible).toBe(false)
      expect(groundDots(renderer.scene.instance)).toEqual([])
    } finally {
      await act(async () => renderer.unmount())
    }
  })
}

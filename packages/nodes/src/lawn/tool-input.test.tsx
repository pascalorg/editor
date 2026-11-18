import { expect, test } from 'bun:test'
import {
  BuildingNode,
  clearSceneHistory,
  createSceneApi,
  emitter,
  FLAT_GROUND_Y,
  LawnNode,
  LevelNode,
  SiteNode,
  useLiveNodeOverrides,
  useScene,
} from '@pascal-app/core'
import {
  RegistryToolProvider,
  sceneLayout,
  useEditor,
  useInteractionScope,
} from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { act, create } from '@react-three/test-renderer'
import { Window as TestWindow } from 'happy-dom'
import { createElement } from 'react'
import { PerspectiveCamera, Plane, Raycaster, Vector2, Vector3 } from 'three'
import { useLawnAuthoring } from './brush'
import { useLawnDraft } from './draft'
import MoveLawnTool from './move-tool'
import LawnTool from './tool'

type CanvasToolMode = 'area' | 'brush' | 'move'
type CanvasToolDriver = {
  point: (
    type: 'pointermove' | 'pointerdown' | 'pointerup' | 'click',
    x: number,
    z: number,
  ) => Promise<void>
  gridEvents: () => number
  lawn: LawnNode
}
type CanvasToolRuntime = { canvas: HTMLCanvasElement | null; gridEvents: number }

function installCanvasToolDom() {
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
    MouseEvent: dom.MouseEvent,
    KeyboardEvent: dom.KeyboardEvent,
    requestAnimationFrame: (cb: FrameRequestCallback) => {
      cb(0)
      return 0
    },
    cancelAnimationFrame: () => {},
    IS_REACT_ACT_ENVIRONMENT: true,
  }
  const descriptors = [
    ...Object.keys(globals),
    'WebGLRenderingContext',
    'WebGL2RenderingContext',
  ].map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const)
  for (const [name, value] of Object.entries(globals))
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value })
  return {
    dom,
    restore: async () => {
      await dom.happyDOM.abort()
      for (const [name, descriptor] of descriptors) {
        if (descriptor) Object.defineProperty(globalThis, name, descriptor)
        else Reflect.deleteProperty(globalThis, name)
      }
    },
  }
}

function preserveCanvasToolStores() {
  const saved = {
    scene: useScene.getState(),
    editor: useEditor.getState(),
    viewer: useViewer.getState(),
    scope: useInteractionScope.getState(),
    authoring: useLawnAuthoring.getState(),
    overrides: useLiveNodeOverrides.getState(),
  }
  return () => {
    useScene.setState(saved.scene)
    useEditor.setState(saved.editor)
    useViewer.setState(saved.viewer)
    useInteractionScope.setState(saved.scope)
    useLawnAuthoring.setState(saved.authoring)
    useLiveNodeOverrides.setState(saved.overrides)
    useLawnDraft.setState({ points: [], hover: null, error: null })
    clearSceneHistory()
  }
}

function canvasToolNodes(mode: CanvasToolMode) {
  const site = SiteNode.parse({
    id: 'site_lawn_native',
    children: ['building_lawn_native', ...(mode === 'area' ? [] : ['lawn_native'])],
  })
  const building = BuildingNode.parse({
    id: 'building_lawn_native',
    parentId: site.id,
    children: ['level_lawn_native'],
  })
  const level = LevelNode.parse({ id: 'level_lawn_native', parentId: building.id, level: 2 })
  const lawn = LawnNode.parse({
    id: 'lawn_native',
    parentId: site.id,
    outline: [
      [0, 0],
      [4, 0],
      [4, 4],
      [0, 4],
    ],
    strokes:
      mode === 'move' ? [{ points: [[1, 1]], radiusM: 0.5, strength: 1, effect: 'bare' }] : [],
  })
  return { site, building, level, lawn }
}
type CanvasToolNodes = ReturnType<typeof canvasToolNodes>

function canvasToolCamera() {
  const camera = new PerspectiveCamera(60, 1, 0.1, 1000)
  camera.position.set(0, 10, 10)
  camera.lookAt(0, 0, 0)
  camera.updateMatrixWorld(true)
  const ray = new Raycaster()
  ray.setFromCamera(new Vector2(0, 0), camera)
  expect(ray.ray.intersectPlane(new Plane(new Vector3(0, 1, 0), -20), new Vector3())).toBeNull()
  return camera
}

function seedCanvasToolScene(
  mode: CanvasToolMode,
  { site, building, level, lawn }: CanvasToolNodes,
) {
  useScene.setState({
    nodes: {
      [site.id]: site,
      [building.id]: building,
      [level.id]: level,
      ...(mode === 'area' ? {} : { [lawn.id]: lawn }),
    },
    rootNodeIds: [site.id],
  })
  useEditor.setState({
    mode: mode === 'move' ? 'select' : 'build',
    tool: mode === 'move' ? null : 'lawn',
    workspaceMode: 'edit',
    viewLayouts: { edit: sceneLayout('3d') },
  })
  useEditor.getState().setSnappingMode('polygon', 'off')
  useViewer.getState().setSelection({ buildingId: building.id, levelId: level.id })
  useLawnAuthoring.setState({
    mode: mode === 'move' ? 'area' : mode,
    effect: 'bare',
    radiusM: 0.5,
    strength: 1,
  })
  if (mode === 'move') useEditor.getState().setMovingNode(lawn)
}

function mountCanvasTool(
  mode: CanvasToolMode,
  { level, lawn }: CanvasToolNodes,
  camera: PerspectiveCamera,
  dom: TestWindow,
  runtime: CanvasToolRuntime,
) {
  return create(
    createElement(RegistryToolProvider, {
      value: {
        activeLevelId: level.id,
        sceneApi: createSceneApi(useScene),
        isCameraDragging: () => false,
        selectNode: () => {},
        unit: 'metric',
      },
      children:
        mode === 'move' ? createElement(MoveLawnTool, { node: lawn }) : createElement(LawnTool),
    }),
    {
      camera,
      width: 200,
      height: 200,
      beforeReturn: (element) => {
        runtime.canvas = element
        element.getBoundingClientRect = () => new dom.DOMRect(0, 0, 200, 200)
        document.body.append(element)
      },
    },
  )
}

function observeCanvasGrid(runtime: CanvasToolRuntime) {
  const onGrid = () => {
    runtime.gridEvents++
  }
  emitter.on('grid:move', onGrid)
  emitter.on('grid:pointerdown', onGrid)
  emitter.on('grid:click', onGrid)
  return () => {
    emitter.off('grid:move', onGrid)
    emitter.off('grid:pointerdown', onGrid)
    emitter.off('grid:click', onGrid)
  }
}

function canvasToolDriver(
  { lawn }: CanvasToolNodes,
  camera: PerspectiveCamera,
  runtime: CanvasToolRuntime,
): CanvasToolDriver {
  return {
    lawn,
    gridEvents: () => runtime.gridEvents,
    point: async (type, x, z) =>
      act(async () => {
        if (!runtime.canvas) throw new Error('Expected the mounted tool canvas')
        const ndc = new Vector3(x, FLAT_GROUND_Y, z).project(camera)
        runtime.canvas.dispatchEvent(
          new PointerEvent(type, {
            pointerId: 1,
            isPrimary: true,
            button: 0,
            buttons: type === 'pointerdown' ? 1 : 0,
            clientX: (ndc.x + 1) * 100,
            clientY: (1 - ndc.y) * 100,
            bubbles: true,
            cancelable: true,
          }),
        )
      }),
  }
}

// Native canvas input without grid dispatch: the selected plane is above the camera.
async function withCanvasTool(
  mode: CanvasToolMode,
  run: (driver: CanvasToolDriver) => Promise<void>,
) {
  const environment = installCanvasToolDom()
  const restoreStores = preserveCanvasToolStores()
  const nodes = canvasToolNodes(mode)
  const camera = canvasToolCamera()
  const runtime: CanvasToolRuntime = { canvas: null, gridEvents: 0 }
  let stopObserving = () => {}
  try {
    seedCanvasToolScene(mode, nodes)
    const renderer = await mountCanvasTool(mode, nodes, camera, environment.dom, runtime)
    stopObserving = observeCanvasGrid(runtime)
    clearSceneHistory()
    try {
      await run(canvasToolDriver(nodes, camera, runtime))
    } finally {
      await act(async () => renderer.unmount())
    }
  } finally {
    stopObserving()
    restoreStores()
    await environment.restore()
  }
}

test('raw canvas drawing closes once even when no active-floor grid event can be dispatched', async () =>
  withCanvasTool('area', async (driver) => {
    const corners: [number, number][] = [
      [0, 0],
      [4, 0],
      [0, 4],
      [0, 0],
    ]
    for (const [x, z] of corners) {
      await driver.point('pointerdown', x, z)
      await driver.point('pointerup', x, z)
      await driver.point('click', x, z)
    }
    expect(driver.gridEvents()).toBe(0)
    const lawns = Object.values(useScene.getState().nodes).filter((node) => node.type === 'lawn')
    expect(lawns).toHaveLength(1)
    expect(lawns[0]?.type === 'lawn' ? lawns[0].outline.length : 0).toBe(3)
    expect(useScene.temporal.getState().pastStates).toHaveLength(1)
  }))

test('raw canvas brush down and movement preview then commit one stroke without grid events', async () =>
  withCanvasTool('brush', async (driver) => {
    const before = useScene.getState().nodes
    await driver.point('pointerdown', 1, 1)
    await driver.point('pointermove', 2, 2)
    expect(useScene.getState().nodes).toBe(before)
    expect(useLiveNodeOverrides.getState().overrides.has(driver.lawn.id)).toBe(true)
    await driver.point('pointerup', 2, 2)
    await driver.point('click', 2, 2)
    expect(driver.gridEvents()).toBe(0)
    const lawn = useScene.getState().nodes[driver.lawn.id]
    if (lawn?.type !== 'lawn') throw new Error('Expected the brushed lawn')
    expect(lawn.strokes).toHaveLength(1)
    expect(lawn.strokes[0]?.points).toHaveLength(2)
    expect(lawn.strokes[0]?.points[1]?.[0]).toBeCloseTo(2, 5)
    expect(useScene.temporal.getState().pastStates).toHaveLength(1)
  }))

test('raw canvas movement carries the outline and brush points without an active-floor hit', async () =>
  withCanvasTool('move', async (driver) => {
    await driver.point('pointermove', 2, 2)
    await driver.point('pointermove', 3, 4)
    await driver.point('pointerdown', 3, 4)
    await driver.point('pointerup', 3, 4)
    await driver.point('click', 3, 4)
    expect(driver.gridEvents()).toBe(0)
    const lawn = useScene.getState().nodes[driver.lawn.id]
    if (lawn?.type !== 'lawn') throw new Error('Expected the moved lawn')
    expect(lawn.outline[0]?.[0]).toBeCloseTo(1, 5)
    expect(lawn.outline[0]?.[1]).toBeCloseTo(2, 5)
    expect(lawn.strokes[0]?.points[0]?.[0]).toBeCloseTo(2, 5)
    expect(lawn.strokes[0]?.points[0]?.[1]).toBeCloseTo(3, 5)
    expect(useScene.temporal.getState().pastStates).toHaveLength(1)
  }))

import { expect, test } from 'bun:test'
import {
  clearSceneHistory,
  createSceneApi,
  FLAT_GROUND_Y,
  LawnNode,
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
import { PerspectiveCamera, Vector3 } from 'three'
import MoveLawnTool from './move-tool'

type MoverDriver = {
  point: (type: string, x: number, z: number) => Promise<void>
  space: (down: boolean) => Promise<void>
  cameraDragging: (value: boolean) => void
  lawn: LawnNode
}
type MoverRuntime = { dragging: boolean; canvas: HTMLCanvasElement | null }

function installMoverDom() {
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

function preserveMoverStores() {
  const saved = {
    scene: useScene.getState(),
    editor: useEditor.getState(),
    viewer: useViewer.getState(),
    scope: useInteractionScope.getState(),
    overrides: useLiveNodeOverrides.getState(),
  }
  return () => {
    useScene.setState(saved.scene)
    useEditor.setState(saved.editor)
    useViewer.setState(saved.viewer)
    useInteractionScope.setState(saved.scope)
    useLiveNodeOverrides.setState(saved.overrides)
    clearSceneHistory()
  }
}

function moverFixture() {
  const site = SiteNode.parse({
    id: 'site_lawn_move_navigation',
    children: ['lawn_move_navigation'],
  })
  const lawn = LawnNode.parse({
    id: 'lawn_move_navigation',
    parentId: site.id,
    outline: [
      [0, 0],
      [4, 0],
      [4, 4],
      [0, 4],
    ],
  })
  const camera = new PerspectiveCamera(60, 1, 0.1, 1000)
  camera.position.set(0, 10, 10)
  camera.lookAt(0, 0, 0)
  camera.updateMatrixWorld(true)
  return { site, lawn, camera }
}
type MoverFixture = ReturnType<typeof moverFixture>

function seedMoverScene({ site, lawn }: MoverFixture) {
  useScene.setState({ nodes: { [site.id]: site, [lawn.id]: lawn }, rootNodeIds: [site.id] })
  useEditor.setState({
    mode: 'select',
    tool: null,
    placementDragMode: false,
    workspaceMode: 'edit',
    viewLayouts: { edit: sceneLayout('3d') },
  })
  useEditor.getState().setMovingNode(lawn)
}

function mountMover({ lawn, camera }: MoverFixture, dom: TestWindow, runtime: MoverRuntime) {
  return create(
    createElement(RegistryToolProvider, {
      value: {
        activeLevelId: null,
        sceneApi: createSceneApi(useScene),
        isCameraDragging: () => runtime.dragging,
        selectNode: () => {},
        unit: 'metric',
      },
      children: createElement(MoveLawnTool, { node: lawn }),
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

function moverDriver({ lawn, camera }: MoverFixture, runtime: MoverRuntime): MoverDriver {
  return {
    lawn,
    cameraDragging: (value) => {
      runtime.dragging = value
      useViewer.setState({ cameraDragging: value })
    },
    space: async (down) =>
      act(async () => {
        window.dispatchEvent(
          new KeyboardEvent(down ? 'keydown' : 'keyup', {
            key: ' ',
            code: 'Space',
            bubbles: true,
          }),
        )
      }),
    point: async (type, x, z) =>
      act(async () => {
        if (!runtime.canvas) throw new Error('Expected the native mover canvas')
        const ndc = new Vector3(x, FLAT_GROUND_Y, z).project(camera)
        runtime.canvas.dispatchEvent(
          new PointerEvent(type, {
            pointerId: 1,
            isPrimary: true,
            button: 0,
            clientX: (ndc.x + 1) * 100,
            clientY: (1 - ndc.y) * 100,
            bubbles: true,
            cancelable: true,
          }),
        )
      }),
  }
}

async function withMover(run: (driver: MoverDriver) => Promise<void>) {
  const environment = installMoverDom()
  const restoreStores = preserveMoverStores()
  const fixture = moverFixture()
  const runtime: MoverRuntime = { dragging: false, canvas: null }
  try {
    seedMoverScene(fixture)
    const renderer = await mountMover(fixture, environment.dom, runtime)
    clearSceneHistory()
    try {
      await run(moverDriver(fixture, runtime))
    } finally {
      await act(async () => renderer.unmount())
    }
  } finally {
    restoreStores()
    await environment.restore()
  }
}

for (const settlingAtRelease of [false, true]) {
  test(`a Space-owned primary pan never drops a lawn after Space is released, camera settling=${settlingAtRelease}`, async () =>
    withMover(async (driver) => {
      await driver.point('pointermove', 2, 2)
      await driver.point('pointermove', 3, 4)
      const before = useScene.getState().nodes
      expect(useLiveNodeOverrides.getState().overrides.has(driver.lawn.id)).toBe(true)
      await driver.space(true)
      await driver.point('pointerdown', 3, 4)
      driver.cameraDragging(true)
      await driver.point('pointermove', 5, 5)
      await driver.space(false)
      driver.cameraDragging(settlingAtRelease)
      await driver.point('pointerup', 5, 5)
      await driver.point('click', 5, 5)
      expect(useScene.getState().nodes).toBe(before)
      expect(useScene.temporal.getState().pastStates).toHaveLength(0)
      driver.cameraDragging(false)
      await driver.point('pointermove', 3, 4)
      await driver.point('pointerdown', 3, 4)
      await driver.point('pointerup', 3, 4)
      await driver.point('click', 3, 4)
      expect(useScene.temporal.getState().pastStates).toHaveLength(1)
    }))
}

test('camera settling alone blocks an otherwise valid lawn drop', async () =>
  withMover(async (driver) => {
    await driver.point('pointermove', 2, 2)
    await driver.point('pointermove', 3, 4)
    const before = useScene.getState().nodes
    driver.cameraDragging(true)
    await driver.point('pointerdown', 3, 4)
    await driver.point('pointerup', 3, 4)
    await driver.point('click', 3, 4)
    expect(useScene.getState().nodes).toBe(before)
    expect(useScene.temporal.getState().pastStates).toHaveLength(0)
  }))

test('a navigation-owned release cannot consume a carried press-drag lawn placement', async () =>
  withMover(async (driver) => {
    await driver.point('pointermove', 2, 2)
    await driver.point('pointermove', 3, 4)
    useEditor.setState({ placementDragMode: true })
    const before = useScene.getState().nodes
    await driver.space(true)
    await driver.point('pointerdown', 3, 4)
    await driver.point('pointermove', 5, 5)
    await driver.space(false)
    await driver.point('pointerup', 5, 5)
    await driver.point('click', 5, 5)
    expect(useScene.getState().nodes).toBe(before)
    expect(useScene.temporal.getState().pastStates).toHaveLength(0)
  }))

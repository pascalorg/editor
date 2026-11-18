import { expect, test } from 'bun:test'
import {
  clearSceneHistory,
  createSceneApi,
  LawnNode,
  SiteNode,
  useLiveNodeOverrides,
  useScene,
} from '@pascal-app/core'
import { sceneLayout, useEditor, useInteractionScope } from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { Window as TestWindow } from 'happy-dom'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { useLawnAuthoring } from './brush'
import { useLawnBrushController, useLawnNavigationGuard } from './brush-controller'

type ControllerDriver = {
  start: (point: [number, number], options?: PointerEventInit, target?: Element) => Promise<void>
  move: (point: [number, number]) => Promise<void>
  release: () => Promise<void>
  key: (key: string, target?: Element) => Promise<void>
  cancel: () => Promise<void>
  camera: (active: boolean) => void
  error: () => string | null
  canvas: Element
}
type ControllerRuntime = {
  controller: ReturnType<typeof useLawnBrushController> | null
  allows: ReturnType<typeof useLawnNavigationGuard> | null
  cameraDragging: boolean
}

function installControllerDom() {
  const dom = new TestWindow()
  const globals = {
    window: dom,
    document: dom.document,
    Element: dom.Element,
    HTMLElement: dom.HTMLElement,
    Node: dom.Node,
    Event: dom.Event,
    PointerEvent: dom.PointerEvent,
    KeyboardEvent: dom.KeyboardEvent,
    IS_REACT_ACT_ENVIRONMENT: true,
  }
  const descriptors = Object.keys(globals).map(
    (name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const,
  )
  for (const [name, value] of Object.entries(globals))
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value })
  return async () => {
    await dom.happyDOM.abort()
    for (const [name, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor)
      else Reflect.deleteProperty(globalThis, name)
    }
  }
}

function preserveControllerStores() {
  const saved = {
    scene: useScene.getState(),
    editor: useEditor.getState(),
    scope: useInteractionScope.getState(),
    viewer: useViewer.getState(),
    overrides: useLiveNodeOverrides.getState(),
    authoring: useLawnAuthoring.getState(),
  }
  return () => {
    useScene.setState(saved.scene)
    useEditor.setState(saved.editor)
    useInteractionScope.setState(saved.scope)
    useViewer.setState(saved.viewer)
    useLiveNodeOverrides.setState(saved.overrides)
    useLawnAuthoring.setState(saved.authoring)
    clearSceneHistory()
  }
}

function seedControllerScene(view: '2d' | '3d') {
  const site = SiteNode.parse({ id: 'site_lawn_pointer', children: ['lawn_pointer'] })
  const lawn = LawnNode.parse({
    id: 'lawn_pointer',
    parentId: site.id,
    outline: [
      [0, 0],
      [4, 0],
      [4, 4],
      [0, 4],
    ],
  })
  useScene.setState({ nodes: { [site.id]: site, [lawn.id]: lawn }, rootNodeIds: [site.id] })
  useEditor.setState({
    mode: 'build',
    tool: 'lawn',
    workspaceMode: 'edit',
    viewLayouts: { edit: sceneLayout(view) },
  })
  useLawnAuthoring.setState({ mode: 'brush', effect: 'bare', radiusM: 0.5, strength: 1 })
  clearSceneHistory()
  return site
}

function currentBrushOwner(runtime: ControllerRuntime) {
  const { controller, allows } = runtime
  if (!controller || !allows) throw new Error('Expected a mounted brush owner')
  return { controller, allows }
}

function controllerDriver(canvas: Element, runtime: ControllerRuntime): ControllerDriver {
  const pointer = (type: string, options: PointerEventInit = {}) =>
    new PointerEvent(type, { pointerId: 7, isPrimary: true, button: 0, bubbles: true, ...options })
  return {
    canvas,
    camera: (active) => {
      runtime.cameraDragging = active
    },
    error: () => currentBrushOwner(runtime).controller.error,
    start: async (point, options, target = canvas) =>
      act(async () => {
        const event = pointer('pointerdown', options)
        target.dispatchEvent(event)
        const owner = currentBrushOwner(runtime)
        if (owner.allows(event)) owner.controller.start(point, event)
      }),
    move: async (point) =>
      act(async () => {
        currentBrushOwner(runtime).controller.move(point, { pointerId: 7 })
      }),
    release: async () =>
      act(async () => {
        canvas.dispatchEvent(pointer('pointerup'))
      }),
    key: async (key, target = canvas) =>
      act(async () => {
        target.dispatchEvent(
          new KeyboardEvent('keydown', {
            key,
            code: key === ' ' ? 'Space' : key,
            bubbles: true,
            cancelable: true,
          }),
        )
      }),
    cancel: async () =>
      act(async () => {
        canvas.dispatchEvent(pointer('pointercancel'))
      }),
  }
}

async function mountControllerOwner(view: '2d' | '3d', site: SiteNode) {
  const host = document.createElement('div')
  document.body.append(host)
  const canvas = document.createElement('canvas')
  document.body.append(canvas)
  const root = createRoot(host)
  const sceneApi = createSceneApi(useScene)
  const runtime: ControllerRuntime = { controller: null, allows: null, cameraDragging: false }
  const isCameraDragging = () => runtime.cameraDragging
  const finish = () => {}
  function Owner() {
    runtime.controller = useLawnBrushController({
      sceneApi,
      siteId: site.id,
      view,
      finishTool: finish,
      isCameraDragging,
    })
    runtime.allows = useLawnNavigationGuard()
    return null
  }
  try {
    await act(async () => root.render(createElement(Owner)))
  } catch (error) {
    await act(async () => root.unmount())
    throw error
  }
  return {
    driver: controllerDriver(canvas, runtime),
    unmount: async () => act(async () => root.unmount()),
  }
}

// Mounted interaction owners and real history, without a GPU or mocked scene writes.
async function withController(view: '2d' | '3d', run: (driver: ControllerDriver) => Promise<void>) {
  const restoreDom = installControllerDom()
  const restoreStores = preserveControllerStores()
  try {
    const site = seedControllerScene(view)
    const owner = await mountControllerOwner(view, site)
    try {
      await run(owner.driver)
    } finally {
      await owner.unmount()
    }
  } finally {
    restoreStores()
    await restoreDom()
  }
}

for (const view of ['2d', '3d'] as const) {
  test(`${view}: a generator budget refusal is shown without leaving a preview or undo entry`, async () =>
    withController(view, async (driver) => {
      const outline: [number, number][] = [
        [0, 0],
        [20, 0],
        [20, 30],
        [0, 30],
      ]
      const site = SiteNode.parse({
        id: 'site_lawn_pointer',
        children: ['lawn_pointer'],
        polygon: { type: 'polygon', points: outline },
      })
      const points: [number, number][] = Array.from({ length: 128 }, (_, index) => [
        1 + index / 128,
        1,
      ])
      const lawn = LawnNode.parse({
        id: 'lawn_pointer',
        parentId: site.id,
        outline,
        strokes: Array.from({ length: 4 }, () => ({
          points,
          radiusM: 0.5,
          effect: 'bare',
          strength: 1,
        })),
      })
      useScene.setState({ nodes: { [site.id]: site, [lawn.id]: lawn } })
      clearSceneHistory()
      const before = useScene.getState().nodes
      await driver.start([1, 1])
      expect(driver.error()).toMatch(/work budget/)
      await driver.release()
      expect(useScene.getState().nodes).toBe(before)
      expect(useLiveNodeOverrides.getState().overrides.has(lawn.id)).toBe(false)
      expect(useScene.temporal.getState().pastStates).toHaveLength(0)
    }))
  test(`${view}: one pointer stroke uses live overrides and releases as one undo step`, async () =>
    withController(view, async (driver) => {
      const before = useScene.getState().nodes
      await driver.start([1, 1])
      expect(useInteractionScope.getState().scope.kind).toBe('painting')
      await driver.move([2, 2])
      expect(useScene.getState().nodes).toBe(before)
      expect(useScene.temporal.getState().pastStates).toHaveLength(0)
      await driver.release()
      const node = useScene.getState().nodes.lawn_pointer
      expect(node?.type === 'lawn' ? node.strokes : null).toEqual([
        {
          points: [
            [1, 1],
            [2, 2],
          ],
          radiusM: 0.5,
          effect: 'bare',
          strength: 1,
        },
      ])
      expect(useScene.temporal.getState().pastStates).toHaveLength(1)
      expect(useInteractionScope.getState().scope.kind).toBe('idle')
    }))
  test(`${view}: Escape, pointer cancellation and camera navigation never commit a stroke`, async () =>
    withController(view, async (driver) => {
      const before = useScene.getState().nodes
      await driver.start([1, 1])
      await driver.key('Escape')
      await driver.release()
      await driver.start([1, 1])
      await driver.cancel()
      await driver.release()
      await driver.start([1, 1])
      driver.camera(true)
      await driver.release()
      driver.camera(false)
      await driver.start([1, 1])
      await driver.key(' ')
      await driver.release()
      expect(useScene.getState().nodes).toBe(before)
      expect(useLiveNodeOverrides.getState().overrides.size).toBe(0)
      expect(useScene.temporal.getState().pastStates).toHaveLength(0)
    }))
  test(`${view}: typing, modified primary presses, secondary buttons and non-primary pointers do not paint`, async () =>
    withController(view, async (driver) => {
      const before = useScene.getState().nodes
      const input = document.createElement('input')
      document.body.append(input)
      await driver.start([1, 1], {}, input)
      for (const options of [
        { ctrlKey: true },
        { metaKey: true },
        { shiftKey: true },
        { button: 1, buttons: 4 },
        { button: 2, buttons: 2 },
        { isPrimary: false },
      ]) {
        await driver.start([1, 1], options)
        await driver.release()
      }
      await driver.start([1, 1])
      await driver.key('Escape', input)
      expect(useLiveNodeOverrides.getState().overrides.has('lawn_pointer')).toBe(true)
      await driver.cancel()
      expect(useScene.getState().nodes).toBe(before)
      expect(useScene.temporal.getState().pastStates).toHaveLength(0)
    }))
}

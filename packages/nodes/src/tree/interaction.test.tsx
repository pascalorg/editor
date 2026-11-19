import { expect, test } from 'bun:test'
import {
  BuildingNode,
  clearSceneHistory,
  createSceneApi,
  emitter,
  type GridEvent,
  LevelNode,
  SiteNode,
  TreeNode,
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
import { act as actThree, create } from '@react-three/test-renderer'
import { Window as TestWindow } from 'happy-dom'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import FloorplanTreeTool from './floorplan-tool'
import MoveTreeTool from './move-tool'
import TreeTool from './tool'

function installDom(dom: TestWindow) {
  const identity = { inverse: () => identity }
  class ScreenPoint {
    constructor(
      public x: number,
      public y: number,
    ) {}
    matrixTransform() {
      return this
    }
  }
  const globals = {
    window: dom,
    document: dom.document,
    navigator: dom.navigator,
    HTMLElement: dom.HTMLElement,
    HTMLCanvasElement: dom.HTMLCanvasElement,
    SVGElement: dom.SVGElement,
    Element: dom.Element,
    Node: dom.Node,
    Event: dom.Event,
    MouseEvent: dom.MouseEvent,
    PointerEvent: dom.PointerEvent,
    KeyboardEvent: dom.KeyboardEvent,
    DOMPoint: ScreenPoint,
    requestAnimationFrame: (callback: FrameRequestCallback) => {
      callback(0)
      return 0
    },
    cancelAnimationFrame: () => {},
    IS_REACT_ACT_ENVIRONMENT: true,
  }
  const descriptors = Object.keys(globals).map(
    (name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const,
  )
  for (const [name, value] of Object.entries(globals))
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value })
  return {
    identity,
    restore() {
      for (const [name, descriptor] of descriptors) {
        if (descriptor) Object.defineProperty(globalThis, name, descriptor)
        else Reflect.deleteProperty(globalThis, name)
      }
    },
  }
}

function garden() {
  const site = SiteNode.parse({})
  const building = BuildingNode.parse({
    parentId: site.id,
    position: [10, 0, 5],
    rotation: [0, Math.PI / 2, 0],
  })
  const level = LevelNode.parse({ parentId: building.id, level: 0 })
  const tree = TreeNode.parse({ parentId: site.id, position: [8, 0, 8] })
  useScene.setState({
    nodes: {
      [site.id]: { ...site, children: [building.id, tree.id] },
      [building.id]: { ...building, children: [level.id] },
      [level.id]: level,
      [tree.id]: tree,
    },
    rootNodeIds: [site.id],
    dirtyNodes: new Set(),
    readOnly: false,
  })
  useScene.temporal.getState().resume()
  clearSceneHistory()
  useInteractionScope.getState().end()
  useLiveNodeOverrides.getState().clearAll()
  useEditor.setState({
    mode: 'build',
    tool: 'tree',
    workspaceMode: 'edit',
    viewLayouts: { edit: sceneLayout('split') },
  })
  return { site, building, level, tree }
}

async function withGarden(
  run: (args: ReturnType<typeof garden> & { dom: TestWindow; identity: unknown }) => Promise<void>,
) {
  const stores = [
    useScene,
    useEditor,
    useViewer,
    useInteractionScope,
    useLiveNodeOverrides,
  ] as const
  const saved = stores.map((store) => store.getState())
  const history = useScene.temporal.getState()
  const dom = new TestWindow()
  const globals = installDom(dom)
  try {
    await run({ ...garden(), dom, identity: globals.identity })
  } finally {
    for (const [index, store] of stores.entries())
      (store.setState as (state: unknown, replace: true) => void)(saved[index], true)
    useScene.temporal.setState(history)
    await dom.happyDOM.abort()
    globals.restore()
  }
}

function gridEvent(target: EventTarget, x: number, z: number): GridEvent {
  return {
    position: [x, 0, z],
    localPosition: [x, 0, z],
    nativeEvent: {
      target,
      buttons: 0,
      altKey: true,
      shiftKey: false,
      ctrlKey: false,
      metaKey: false,
    },
  } as unknown as GridEvent
}

test('one plan click with both adapters mounted places one Site tree and undoes once', async () =>
  withGarden(async ({ site, level, dom, identity }) => {
    const selected: string[] = []
    const sceneApi = createSceneApi(useScene)
    const context = {
      activeLevelId: level.id,
      sceneApi,
      selectNode: (id: string) => selected.push(id),
      unit: 'metric' as const,
      isCameraDragging: () => false,
    }
    const root = createRoot(document.body)
    const renderer = await create(
      <RegistryToolProvider value={context}>
        <TreeTool />
      </RegistryToolProvider>,
    )
    const before = useScene.getState().nodes
    try {
      await act(async () =>
        root.render(
          <svg>
            <FloorplanTreeTool
              {...({
                ...context,
                drawingType: 'floor-plan',
                finishTool: () => useEditor.getState().setTool(null),
              } as Parameters<typeof FloorplanTreeTool>[0])}
            />
          </svg>,
        ),
      )
      const svg = document.querySelector('svg')
      const group = document.querySelector('g')
      if (!svg || !group) throw new Error('Missing plan placement adapter')
      Object.defineProperty(group, 'getScreenCTM', { value: () => identity })
      let forwarded = 0
      svg.addEventListener('click', () => forwarded++)
      await act(async () =>
        svg.dispatchEvent(
          new dom.MouseEvent('click', {
            bubbles: true,
            cancelable: true,
            button: 0,
            clientX: 2,
            clientY: 3,
            altKey: true,
          }) as unknown as Event,
        ),
      )
      await actThree(async () => emitter.emit('grid:click', gridEvent(svg, 2, 3)))
      expect(forwarded).toBe(0)
      expect(selected).toHaveLength(1)
      const id = selected[0]
      if (!id) throw new Error('The placed tree was not selected')
      // Quarter turn (2,3) -> (3,-2), plus building position (10,5).
      expect(useScene.getState().nodes[id as TreeNode['id']]).toMatchObject({
        type: 'tree',
        parentId: site.id,
        position: [13, 0, 3],
      })
      expect(useScene.temporal.getState().pastStates).toHaveLength(1)
      await act(async () => useScene.temporal.getState().undo())
      expect(useScene.getState().nodes).toEqual(before)
    } finally {
      await act(async () => root.unmount())
      await actThree(async () => renderer.unmount())
    }
  }))

test.each(['cancel', 'commit'] as const)(
  'the actual 3D mover previews without writes and handles %s with one or zero undo steps',
  async (ending) =>
    withGarden(async ({ tree, dom }) => {
      useEditor.setState({ viewLayouts: { edit: sceneLayout('3d') } })
      useEditor.getState().setMovingNode(tree)
      const root = createRoot(document.body)
      const canvas = document.createElement('canvas')
      const before = useScene.getState().nodes
      try {
        await act(async () => root.render(<MoveTreeTool node={tree} />))
        await act(async () => {
          emitter.emit('grid:move', gridEvent(canvas, 0, 0))
          emitter.emit('grid:move', gridEvent(canvas, 2, 3))
        })
        expect(useScene.getState().nodes).toBe(before)
        expect(useLiveNodeOverrides.getState().get(tree.id)).toMatchObject({
          position: [10, 0, 11],
        })
        expect(useScene.temporal.getState().pastStates).toHaveLength(0)
        await act(async () => {
          if (ending === 'cancel')
            dom.dispatchEvent(new dom.KeyboardEvent('keydown', { key: 'Escape' }))
          else emitter.emit('grid:click', gridEvent(canvas, 2, 3))
        })
        if (ending === 'cancel')
          await act(async () => emitter.emit('grid:click', gridEvent(canvas, 2, 3)))
        await act(async () => root.unmount())
        expect(useLiveNodeOverrides.getState().get(tree.id)).toBeUndefined()
        expect(useInteractionScope.getState().scope.kind).toBe('idle')
        expect(useScene.temporal.getState().pastStates).toHaveLength(ending === 'commit' ? 1 : 0)
        if (ending === 'commit') {
          expect(useScene.getState().nodes[tree.id]).toMatchObject({ position: [10, 0, 11] })
          await act(async () => useScene.temporal.getState().undo())
        }
        expect(useScene.getState().nodes).toEqual(before)
      } finally {
        await act(async () => root.unmount())
      }
    }),
)

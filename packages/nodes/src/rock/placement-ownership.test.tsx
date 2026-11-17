import { expect, test } from 'bun:test'
import {
  BuildingNode,
  clearSceneHistory,
  createSceneApi,
  emitter,
  type GridEvent,
  LevelNode,
  SiteNode,
  useScene,
} from '@pascal-app/core'
import {
  RegistryToolProvider,
  sceneLayout,
  useEditor,
  useInteractionScope,
} from '@pascal-app/editor'
import { act as actThree, create } from '@react-three/test-renderer'
import { Window as TestWindow } from 'happy-dom'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import FloorplanRockTool from './floorplan-tool'
import RockTool from './tool'

test('one SVG click with both actual placement adapters mounted creates one transformed rock and one undo step', async () => {
  const dom = new TestWindow()
  // Happy DOM supplies SVG event dispatch. Its missing screen-projection API is
  // supplied as an identity viewport; the real plan-to-Site transform stays production.
  const identity = {
    inverse() {
      return this
    },
  }
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
  const saved = {
    scene: useScene.getState(),
    history: useScene.temporal.getState(),
    editor: useEditor.getState(),
    scope: useInteractionScope.getState(),
  }
  for (const [name, value] of Object.entries(globals)) {
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value })
  }
  const site = SiteNode.parse({
    polygon: {
      type: 'polygon',
      points: [
        [-30, -30],
        [30, -30],
        [30, 30],
        [-30, 30],
      ],
    },
  })
  const building = BuildingNode.parse({
    parentId: site.id,
    position: [10, 0, 5],
    rotation: [0, Math.PI / 2, 0],
  })
  const level = LevelNode.parse({ parentId: building.id, level: 0 })
  useScene.setState({
    nodes: {
      [site.id]: { ...site, children: [building.id] },
      [building.id]: { ...building, children: [level.id] },
      [level.id]: level,
    },
    rootNodeIds: [site.id],
    readOnly: false,
    dirtyNodes: new Set(),
  })
  useScene.temporal.getState().resume()
  clearSceneHistory()
  useInteractionScope.getState().end()
  useEditor.setState({
    mode: 'build',
    tool: 'rock',
    workspaceMode: 'edit',
    viewLayouts: { edit: sceneLayout('split') },
  })
  const before = useScene.getState().nodes
  const sceneApi = createSceneApi(useScene)
  const selected: string[] = []
  const selectNode = (id: string) => selected.push(id)
  const root = createRoot(document.body)
  let scene: Awaited<ReturnType<typeof create>> | undefined
  try {
    scene = await create(
      <RegistryToolProvider
        value={{
          activeLevelId: level.id,
          sceneApi,
          selectNode,
          unit: 'metric',
          isCameraDragging: () => false,
        }}
      >
        <RockTool />
      </RegistryToolProvider>,
    )
    await act(async () =>
      root.render(
        <svg>
          <FloorplanRockTool
            {...({
              sceneApi,
              activeLevelId: level.id,
              drawingType: 'floor-plan',
              selectNode,
              finishTool: () => useEditor.getState().setTool(null),
            } as Parameters<typeof FloorplanRockTool>[0])}
          />
        </svg>,
      ),
    )
    expect(useInteractionScope.getState().scope).toMatchObject({ kind: 'drafting', tool: 'rock' })
    const svg = document.querySelector('svg')!
    const group = document.querySelector('g')!
    Object.defineProperty(group, 'getScreenCTM', { value: () => identity })
    let forwarded = 0
    svg.addEventListener('click', () => {
      forwarded++
    })
    await act(async () => {
      svg.dispatchEvent(
        new dom.MouseEvent('click', {
          bubbles: true,
          cancelable: true,
          button: 0,
          clientX: 2,
          clientY: 3,
          altKey: true,
        }) as unknown as Event,
      )
    })
    expect(forwarded).toBe(0)
    // Even if another input source forwards that same SVG event, canvas placement refuses it.
    await actThree(async () =>
      emitter.emit('grid:click', {
        position: [2, 0, 3],
        localPosition: [2, 0, 3],
        nativeEvent: { target: svg, altKey: true },
      } as unknown as GridEvent),
    )
    const rocks = Object.values(useScene.getState().nodes).filter((node) => node.type === 'rock')
    expect(rocks).toHaveLength(1)
    expect(selected).toEqual([rocks[0]!.id])
    expect(rocks[0]!.parentId).toBe(site.id)
    // Quarter turn: (2,3) -> (3,-2), then (10,5), giving centre (13,3).
    // Source click footprint has opposing 1.5m X radii; this does not use its generator as oracle.
    const xs = rocks[0]!.polygon.map(([x]) => x)
    expect(Math.min(...xs)).toBeCloseTo(11.5, 8)
    expect(Math.max(...xs)).toBeCloseTo(14.5, 8)
    expect(useScene.temporal.getState().pastStates).toHaveLength(1)
    await act(async () => useScene.temporal.getState().undo())
    expect(useScene.getState().nodes).toEqual(before)
    await act(async () => dom.dispatchEvent(new dom.KeyboardEvent('keydown', { key: 'Escape' })))
    expect(useInteractionScope.getState().scope.kind).toBe('idle')
    expect(useScene.getState().nodes).toEqual(before)
  } finally {
    await act(async () => root.unmount())
    if (scene) await actThree(async () => scene!.unmount())
    useScene.setState(saved.scene, true)
    useScene.temporal.setState(saved.history)
    useEditor.setState(saved.editor, true)
    useInteractionScope.setState(saved.scope, true)
    await dom.happyDOM.abort()
    for (const [name, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor)
      else Reflect.deleteProperty(globalThis, name)
    }
  }
})

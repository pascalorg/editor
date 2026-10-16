import { beforeEach, describe, expect, jest, test } from 'bun:test'
import {
  type AnyNode,
  type AnyNodeDefinition,
  type AnyNodeId,
  createSceneApi,
  type FenceNode,
  GROUND_SUPPORT_ID,
  type GridEvent,
  nodeRegistry,
  registerNode,
  type SlabNode,
  spatialGridManager,
  useScene,
} from '@pascal-app/core'
import { useEditor } from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { z } from 'zod'
import { createFenceOnCurrentLevel, getFenceDrawingSurface, snapFenceDraftPoint } from './drafting'

const LEVEL_ID = 'level_test' as AnyNodeId

function seedLevel(extraNodes: AnyNode[] = []) {
  useScene.setState({
    nodes: Object.fromEntries([
      [
        LEVEL_ID,
        {
          id: LEVEL_ID,
          type: 'level',
          object: 'node',
          parentId: null,
          visible: true,
          metadata: {},
          children: extraNodes.map((node) => node.id),
          level: 0,
        } as AnyNode,
      ],
      ...extraNodes.map((node) => [node.id, node] as const),
    ]),
    rootNodeIds: [LEVEL_ID],
    dirtyNodes: new Set(),
    collections: {},
  } as never)
}

describe('createFenceOnCurrentLevel', () => {
  beforeEach(() => {
    spatialGridManager.clear()
    useViewer.setState({
      selection: {
        buildingId: null,
        levelId: LEVEL_ID,
        zoneId: null,
        selectedIds: [],
      },
    } as never)
    useEditor.getState().setToolDefaults('fence', null)
    seedLevel()
  })

  test('freezes a block top above its underlying slab', () => {
    const slab = {
      id: 'slab_low',
      type: 'slab',
      object: 'node',
      parentId: LEVEL_ID,
      visible: true,
      metadata: {},
      children: [],
      polygon: [
        [-2, -2],
        [2, -2],
        [2, 2],
        [-2, 2],
      ],
      holes: [],
      holeMetadata: [],
      elevation: 0.25,
      thickness: 0.25,
      recessed: false,
      autoFromWalls: false,
    } as SlabNode
    seedLevel([slab as AnyNode])
    spatialGridManager.handleNodeCreated(slab as AnyNode, LEVEL_ID)

    const fence = createFenceOnCurrentLevel(
      [-1, 0],
      [1, 0],
      {
        supportCap: 2,
        preferredSupportSlabId: slab.id,
        constructionElevation: 2,
      },
      { sceneApi: createSceneApi(useScene), levelId: LEVEL_ID },
    )

    expect(fence?.supportSlabId).toBe(slab.id)
    expect(fence?.supportOffset).toBeCloseTo(1.75)
  })

  test('pins ground beneath a block top when no slab exists', () => {
    const fence = createFenceOnCurrentLevel(
      [-1, 0],
      [1, 0],
      {
        supportCap: 2,
        preferredSupportSlabId: null,
        constructionElevation: 2,
      },
      { sceneApi: createSceneApi(useScene), levelId: LEVEL_ID },
    )

    expect(fence?.supportSlabId).toBe(GROUND_SUPPORT_ID)
    expect(fence?.supportOffset).toBeCloseTo(2)
  })
})

// Actual public ToolManager supplies the private registry context and mounts
// FenceTool's curved branch. No private handler extraction, business mocks or
// cross-package source import. This does not prove native focus or editing.
test('focus completion: ready spline fence ignores fields and commits outside Enter', async () => {
  const core = await import('@pascal-app/core')
  const editor = await import('@pascal-app/editor')
  const viewer = await import('@pascal-app/viewer')
  const { createRoot, extend } = await import('@react-three/fiber')
  const { act, createElement } = await import('react')
  const three = await import('three')
  const { LineBasicNodeMaterial } = await import('three/webgpu')
  const { fenceDefinition } = await import('./definition')
  const stores = [
    ...new Set([...Object.values(core), ...Object.values(editor), ...Object.values(viewer)]),
  ].filter((value: any) => value?.getState && value?.setState) as Array<{
    getState(): any
    setState(value: any, replace: true): void
  }>
  stores.push(core.useScene.temporal)
  const saved = stores.map((store) => store.getState())
  const restoreRegistry = core.nodeRegistry._snapshot()
  const originalMeshes = new Map(core.sceneRegistry.nodes)
  const keys = [
    'window',
    'document',
    'HTMLCanvasElement',
    'requestAnimationFrame',
    'cancelAnimationFrame',
    'IS_REACT_ACT_ENVIRONMENT',
  ] as const
  const globals = keys.map((key) => Object.getOwnPropertyDescriptor(globalThis, key))
  const frames = new Map<number, FrameRequestCallback>()
  let frameId = 0
  const flush = () => {
    const pending = [...frames.values()]
    frames.clear()
    for (const callback of pending) callback(0)
  }
  const settle = async () => {
    await act(async () => {
      jest.advanceTimersByTime(20)
      flush()
    })
  }
  const windowTarget = Object.assign(new EventTarget(), {
    matchMedia: () => Object.assign(new EventTarget(), { matches: false }),
  })
  const documentTarget = Object.assign(new EventTarget(), {
    body: { style: { cursor: '' } },
    querySelector: () => null,
  })
  let root: ReturnType<typeof createRoot> | undefined
  jest.useFakeTimers()
  try {
    Object.defineProperties(globalThis, {
      document: { configurable: true, value: documentTarget },
      window: { configurable: true, value: windowTarget },
      HTMLCanvasElement: { configurable: true, value: class {} },
      requestAnimationFrame: {
        configurable: true,
        value: (callback: FrameRequestCallback) => {
          frames.set(++frameId, callback)
          return frameId
        },
      },
      cancelAnimationFrame: { configurable: true, value: (id: number) => frames.delete(id) },
      IS_REACT_ACT_ENVIRONMENT: { configurable: true, value: true },
    })
    core.registerNode(fenceDefinition)
    const level = 'level_focus_fence' as AnyNodeId
    core.useScene.temporal.getState().pause()
    core.useScene.setState({
      nodes: {
        [level]: {
          id: level,
          type: 'level',
          object: 'node',
          parentId: null,
          visible: true,
          metadata: {},
          children: [],
          level: 0,
        },
      },
      rootNodeIds: [level],
      dirtyNodes: new Set(),
      collections: {},
    } as never)
    core.useScene.temporal.getState().resume()
    core.clearSceneHistory()
    viewer.useViewer
      .getState()
      .setSelection({ levelId: level, buildingId: null, zoneId: null, selectedIds: [] })
    editor.useEditor.setState({
      viewMode: '3d',
      phase: 'building',
      isFloorplanHovered: true,
      gridSnapStep: 0.5,
      continuationByContext: {
        ...editor.useEditor.getState().continuationByContext,
        fence: 'curved',
      },
    })
    editor.useEditor.getState().setToolDefaults('fence', null)
    editor.useEditor.getState().armToolMode({ mode: 'build', tool: 'fence' })
    core.useScene.getState().updateNode(level, { name: 'history sentinel' } as never)
    await settle()
    await editor.preloadRegistryToolModules('fence')
    extend({ ...three, LineBasicNodeMaterial })
    const scene = new three.Scene()
    const gl = {
      domElement: {},
      setSize() {},
      setPixelRatio() {},
      render() {
        throw new Error('CPU controller acceptance must not render')
      },
    }
    root = createRoot({} as HTMLCanvasElement)
    await root.configure({
      gl: gl as never,
      scene,
      frameloop: 'never',
      size: { width: 320, height: 240, top: 0, left: 0 },
    })
    await act(async () => {
      root!.render(createElement(editor.ToolManager))
    })
    await settle()
    const snapshot = () =>
      JSON.parse(
        JSON.stringify({
          nodes: core.useScene.getState().nodes,
          points: editor.useFenceCurveDraft.getState().points,
          count: editor.useFenceCurveDraft.getState().pointCount,
          preview: editor.usePlacementPreview.getState().node,
          selection: viewer.useViewer.getState().selection,
          mode: editor.useEditor.getState().mode,
          tool: editor.useEditor.getState().tool,
          history: {
            past: core.useScene.temporal.getState().pastStates,
            future: core.useScene.temporal.getState().futureStates,
            tracking: core.useScene.temporal.getState().isTracking,
            pauseDepth: core.getSceneHistoryPauseDepth(),
          },
        }),
      )
    const empty = snapshot()
    const endpoints = [
      [0, 0],
      [4, 0],
    ]
    for (const [x, z] of endpoints) {
      const event = {
        position: [x, 0, z],
        localPosition: [x, 0, z],
        nativeEvent: { target: documentTarget.body, detail: 1, button: 0 },
      } as unknown as GridEvent
      await act(async () => {
        core.emitter.emit('grid:move', event)
      })
      await settle()
      await act(async () => {
        core.emitter.emit('grid:click', event)
      })
      await settle()
    }
    const before = snapshot()
    expect(before.points).toEqual(endpoints)
    expect(before.count).toBe(2)
    expect(before.preview.path).toEqual(endpoints)
    expect(before.nodes).toEqual(empty.nodes)
    expect(before.history).toEqual(empty.history)
    expect(before.history.past.length).toBeGreaterThan(0)
    expect(before.history.tracking).toBe(true)
    expect(before.history.pauseDepth).toBe(0)
    let actualPreview = false
    scene.traverse((object) => {
      if (object instanceof three.Mesh && object.geometry.getAttribute('position')?.count >= 3)
        actualPreview = true
    })
    expect(actualPreview).toBe(true)
    const enter = async (target: object) => {
      const event = new Event('keydown', { cancelable: true })
      Object.defineProperties(event, { key: { value: 'Enter' }, target: { value: target } })
      await act(async () => {
        windowTarget.dispatchEvent(event)
        flush()
      })
      await settle()
      return event
    }
    for (const target of [
      { tagName: 'TEXTAREA', closest: () => ({ tagName: 'TEXTAREA' }) },
      { tagName: 'INPUT', closest: () => ({ tagName: 'INPUT' }) },
      { tagName: 'SELECT', closest: () => ({ tagName: 'SELECT' }) },
      { tagName: 'SPAN', isContentEditable: true },
      { tagName: 'SPAN', closest: () => ({ isContentEditable: true }) },
    ]) {
      expect((await enter(target)).defaultPrevented).toBe(false)
      expect(snapshot()).toEqual(before)
    }
    // Fence deliberately preserves its established unprevented outside Enter.
    expect((await enter({ tagName: 'CANVAS' })).defaultPrevented).toBe(false)
    const after = snapshot()
    const created = Object.values(core.useScene.getState().nodes).filter(
      (node) => node.type === 'fence',
    ) as FenceNode[]
    expect(created).toHaveLength(1)
    expect(created[0]!.path).toEqual(endpoints)
    expect(created[0]!.start).toEqual(endpoints[0])
    expect(created[0]!.end).toEqual(endpoints[1])
    expect(created[0]!.parentId).toBe(level)
    expect(after.points).toEqual([])
    expect(after.count).toBe(0)
    expect(after.history.past).toHaveLength(before.history.past.length + 1)
    await act(async () => {
      core.useScene.temporal.getState().undo()
      flush()
    })
    expect(core.useScene.getState().nodes).toEqual(before.nodes)
  } finally {
    if (root)
      await act(async () => {
        root!.unmount()
      })
    jest.runOnlyPendingTimers()
    frames.clear()
    restoreRegistry()
    core.sceneRegistry.nodes.clear()
    for (const [id, mesh] of originalMeshes) core.sceneRegistry.nodes.set(id, mesh)
    stores.forEach((store, index) => {
      store.setState(saved[index], true)
    })
    jest.useRealTimers()
    keys.forEach((key, index) => {
      const descriptor = globals[index]
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else Reflect.deleteProperty(globalThis, key)
    })
  }
}, 15_000)

test('railing snaps use inset edges and corners on the active floor at the deck top', () => {
  const kind = 'test:railing-platform'
  if (!nodeRegistry.has(kind))
    registerNode({
      kind,
      schemaVersion: 1,
      schema: z.object({ type: z.literal(kind) }),
      category: 'site',
      defaults: () => ({}),
      capabilities: {
        surfaces: {
          top: {
            height: 0.4,
            boundary: (_node, inset = 0) => [
              [inset, inset],
              [4 - inset, inset],
              [4 - inset, 3 - inset],
              [inset, 3 - inset],
            ],
          },
        },
      },
    } as AnyNodeDefinition)
  const deck = {
    id: 'platform_rail',
    type: kind,
    parentId: LEVEL_ID,
    position: [0, 0.8, 0],
  } as unknown as AnyNode
  seedLevel([deck])
  useViewer.setState({ selection: { ...useViewer.getState().selection, levelId: LEVEL_ID } })
  useEditor.getState().setToolDefaults('fence', { supportSurfaceNodeId: deck.id })
  const support = getFenceDrawingSurface()
  expect(support?.elevation).toBeCloseTo(1.2)
  expect(support?.boundary[0]).toEqual([0.08, 0.08])
  expect(snapFenceDraftPoint({ point: [0.1, 0.1], walls: [], fences: [], magnetic: true })).toEqual(
    [0.08, 0.08],
  )
  expect(snapFenceDraftPoint({ point: [2, 0.1], walls: [], fences: [], magnetic: true })).toEqual([
    2, 0.08,
  ])
  expect(getFenceDrawingSurface(useScene.getState().nodes, deck.id, 'level_other')).toBeNull()
  useEditor.getState().setToolDefaults('fence', null)
})

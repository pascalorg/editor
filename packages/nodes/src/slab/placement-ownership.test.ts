import { describe, expect, jest, test } from 'bun:test'
import type { AnyNodeId, GridEvent, SlabNode } from '@pascal-app/core'
import { type SlabCompletionTrigger, shouldRegistryCommitSlab } from './placement-ownership'

function slabCreatorCount(viewMode: '2d' | '3d' | 'split', trigger: SlabCompletionTrigger): number {
  const floorplanCommits = viewMode === '2d' && trigger === 'grid'
  const registryCommits = shouldRegistryCommitSlab(viewMode, trigger)
  return Number(floorplanCommits) + Number(registryCommits)
}

describe('slab placement ownership', () => {
  test.each([
    ['2d', 'grid'],
    ['2d', 'keyboard'],
    ['3d', 'grid'],
    ['split', 'grid'],
  ] as const)('commits one slab in %s from %s completion', (viewMode, trigger) => {
    expect(slabCreatorCount(viewMode, trigger)).toBe(1)
  })
})

// Focus ownership is exercised through the real SlabTool, local React draft,
// Core grid emitter and scene history. Synthetic CPU events are NOT native DOM
// editing or GPU evidence; the owned native acceptance supplies that boundary.
test('focus completion: ready SlabTool ignores fields and commits outside Enter', async () => {
  const core = await import('@pascal-app/core')
  const editor = await import('@pascal-app/editor')
  const viewer = await import('@pascal-app/viewer')
  const { createRoot, extend } = await import('@react-three/fiber')
  const { act, createElement } = await import('react')
  const three = await import('three')
  const { LineBasicNodeMaterial } = await import('three/webgpu')
  const { SlabTool } = await import('./tool')
  const { slabDefinition } = await import('./definition')
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
  const documentTarget = Object.assign(new EventTarget(), {
    body: { style: { cursor: '' } },
    querySelector: () => null,
  })
  let root: ReturnType<typeof createRoot> | undefined
  jest.useFakeTimers()
  try {
    Object.defineProperties(globalThis, {
      document: { configurable: true, value: documentTarget },
      window: {
        configurable: true,
        value: Object.assign(new EventTarget(), {
          matchMedia: () => Object.assign(new EventTarget(), { matches: false }),
        }),
      },
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
    core.registerNode(slabDefinition)
    const level = 'level_focus_slab' as AnyNodeId
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
      mode: 'build',
      tool: 'slab',
      isFloorplanHovered: true,
      gridSnapStep: 0.5,
    })
    editor.useEditor.getState().setToolDefaults('slab', null)
    core.useScene.getState().updateNode(level, { name: 'history sentinel' } as never)
    await settle()
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
      root!.render(createElement(SlabTool))
    })
    const snapshot = () =>
      JSON.parse(
        JSON.stringify({
          nodes: core.useScene.getState().nodes,
          points: editor.useFloorplanDraftPreview.getState().polygonDraftPoints,
          count: editor.useEditor.getState().draftVertexCount,
          selection: viewer.useViewer.getState().selection,
          history: {
            past: core.useScene.temporal.getState().pastStates,
            future: core.useScene.temporal.getState().futureStates,
            tracking: core.useScene.temporal.getState().isTracking,
            pauseDepth: core.getSceneHistoryPauseDepth(),
          },
        }),
      )
    const empty = snapshot()
    const triangle = [
      [0, 0],
      [4, 0],
      [4, 3],
    ]
    for (const [x, z] of triangle) {
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
    expect(before.points).toEqual(triangle)
    expect(before.count).toBe(3)
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
        documentTarget.dispatchEvent(event)
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
    expect((await enter({ tagName: 'CANVAS' })).defaultPrevented).toBe(true)
    const after = snapshot()
    const created = Object.values(core.useScene.getState().nodes).filter(
      (node) => node.type === 'slab',
    ) as SlabNode[]
    expect(created).toHaveLength(1)
    expect(created[0]!.polygon).toEqual(triangle)
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

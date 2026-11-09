import { expect, jest, test } from 'bun:test'
import type {
  AnyNode,
  AnyNodeDefinition,
  AnyNodeId,
  BuildingNode,
  LevelNode,
} from '@pascal-app/core'
import type { Catalogue } from '@react-three/fiber'
import { resolveMoveRotationStep } from './move-registry-node-tool'

test('applies a free rotation step while the move is unattached', () => {
  expect(resolveMoveRotationStep(0.5, 0.25, null)).toBeCloseTo(0.75)
})

test('rejects rotation steps while the move is wall-attached', () => {
  expect(resolveMoveRotationStep(0.5, 0.25, Math.PI / 2)).toBeNull()
})

// Contract-derived controller regression, not a helper replay: editable keys
// leave a live move alone; outside R/T and Alt still affect the real controller.
// R3F reconciles real Three objects with a rendererless context. No drawing,
// native typing, canvas hit-testing or GPU evidence is claimed by this test.
test('focus completion: mounted registry mover owns only outside R T and Alt', async () => {
  const core = await import('@pascal-app/core')
  const { useViewer } = await import('@pascal-app/viewer')
  const { createRoot, extend } = await import('@react-three/fiber')
  const { act, createElement } = await import('react')
  const three = await import('three')
  const { z } = await import('zod')
  const { MoveRegistryNodeTool } = await import('./move-registry-node-tool')
  const { default: useEditor } = await import('../../../store/use-editor')
  const { default: useInteractionScope } = await import('../../../store/use-interaction-scope')
  const { default: useAlignmentGuides } = await import('../../../store/use-alignment-guides')
  const { default: useFacingPose } = await import('../../../store/use-facing-pose')
  const { default: usePlacementPreview } = await import('../../../store/use-placement-preview')
  const globals = [
    'window',
    'document',
    'requestAnimationFrame',
    'cancelAnimationFrame',
    'IS_REACT_ACT_ENVIRONMENT',
  ] as const
  const descriptors = globals.map((key) => Object.getOwnPropertyDescriptor(globalThis, key))
  const stores = [
    core.useScene,
    core.useScene.temporal,
    useViewer,
    useEditor,
    useInteractionScope,
    core.useLiveTransforms,
    core.useLiveNodeOverrides,
    useAlignmentGuides,
    useFacingPose,
    usePlacementPreview,
  ]
  const originalStates = stores.map((store) => store.getState())
  const restoreRegistry = core.nodeRegistry._snapshot()
  const sceneObjects = new Map(core.sceneRegistry.nodes)
  const frames = new Map<number, FrameRequestCallback>()
  let nextFrame = 0
  let time = 0
  const flushFrames = () => {
    const pending = [...frames.values()]
    frames.clear()
    for (const callback of pending) {
      time += 16
      callback(time)
    }
  }
  let root: ReturnType<typeof createRoot> | undefined
  let mountedScene: import('three').Scene | undefined
  const mesh = new three.Mesh(new three.BoxGeometry(1, 1, 1), new three.MeshBasicMaterial())
  const id = 'completion_registry' as AnyNodeId
  const buildingId = 'building_completion_registry' as BuildingNode['id']
  const levelId = 'level_completion_registry' as LevelNode['id']
  const node = {
    id,
    type: 'completion:registry',
    object: 'node',
    parentId: levelId,
    children: [],
    metadata: {},
    visible: true,
    position: [2, 0, 3],
    rotation: 0.25,
  } as unknown as AnyNode
  jest.useFakeTimers()
  try {
    const target = new EventTarget()
    const documentFixture = { body: { style: { cursor: '' } }, querySelector: () => null }
    Object.defineProperties(globalThis, {
      window: {
        configurable: true,
        value: Object.assign(target, {
          matchMedia: () => Object.assign(new EventTarget(), { matches: false }),
        }),
      },
      document: { configurable: true, value: documentFixture },
      requestAnimationFrame: {
        configurable: true,
        value: (callback: FrameRequestCallback) => {
          frames.set(++nextFrame, callback)
          return nextFrame
        },
      },
      cancelAnimationFrame: { configurable: true, value: (key: number) => frames.delete(key) },
      IS_REACT_ACT_ENVIRONMENT: { configurable: true, value: true },
    })
    core.registerNode({
      kind: node.type,
      schemaVersion: 1,
      category: 'utility',
      schema: z.object({ type: z.literal(node.type) }).passthrough(),
      defaults: () => ({}),
      capabilities: {
        movable: { isValidPosition: () => false },
        floorPlaced: {
          collides: true,
          footprint: (candidate: AnyNode) => ({
            dimensions: [1, 1, 1],
            rotation: [0, (candidate as unknown as { rotation: number }).rotation, 0],
          }),
        },
      },
    } as unknown as AnyNodeDefinition)
    core.useScene.temporal.getState().pause()
    // Placement validity is level-scoped. Without a real selected level the
    // mover deliberately treats placement as valid before consulting the kind.
    core.useScene.setState({
      nodes: {
        [buildingId]: {
          id: buildingId,
          type: 'building',
          parentId: null,
          children: [levelId],
          position: [0, 0, 0],
          rotation: 0,
        } as unknown as AnyNode,
        [levelId]: {
          id: levelId,
          type: 'level',
          parentId: buildingId,
          children: [id],
          elevation: 0,
          height: 3,
        } as unknown as AnyNode,
        [id]: node,
      },
      rootNodeIds: [buildingId],
    })
    core.useScene.temporal.getState().resume()
    core.clearSceneHistory()
    core.useScene.getState().updateNode(id, { name: 'history sentinel' } as never)
    flushFrames()
    useViewer.getState().setSelection({ selectedIds: [id], levelId, buildingId, zoneId: null })
    useEditor.setState({ mode: 'select', tool: null })
    useEditor.getState().setMovingNode(core.useScene.getState().nodes[id]!)
    mesh.position.set(2, 0, 3)
    mesh.rotation.y = 0.25
    core.sceneRegistry.nodes.set(id, mesh)
    extend(three as unknown as Catalogue)
    // Supplying a renderer-shaped context prevents WebGLRenderer construction.
    // Drawing is a hard failure, never a stub returning fake pixels.
    const gl = {
      render: () => {
        throw new Error('CPU controller acceptance must not render')
      },
      setSize: () => {},
      setPixelRatio: () => {},
      domElement: {},
    }
    root = createRoot({} as HTMLCanvasElement)
    await root.configure({
      gl: gl as never,
      frameloop: 'never',
      size: { width: 300, height: 300, top: 0, left: 0 },
      onCreated: (state) => {
        mountedScene = state.scene
      },
    })
    await act(async () => {
      root!.render(
        createElement(MoveRegistryNodeTool, { node: core.useScene.getState().nodes[id]! }),
      )
    })
    const colours = () => {
      const result: number[] = []
      mountedScene!.traverse((object) => {
        const material = (object as import('three').Mesh).material
        for (const entry of Array.isArray(material) ? material : [material]) {
          if (entry && 'color' in entry)
            result.push((entry.color as import('three').Color).getHex())
        }
      })
      return result.sort()
    }
    const snapshot = () =>
      JSON.parse(
        JSON.stringify({
          nodes: core.useScene.getState().nodes,
          live: [...core.useLiveTransforms.getState().transforms],
          overrides: [...core.useLiveNodeOverrides.getState().overrides],
          scope: useInteractionScope.getState().scope,
          history: {
            past: core.useScene.temporal.getState().pastStates,
            future: core.useScene.temporal.getState().futureStates,
            tracking: core.useScene.temporal.getState().isTracking,
            pauseDepth: core.getSceneHistoryPauseDepth(),
          },
          pose: { position: mesh.position.toArray(), rotation: mesh.rotation.y },
          colours: colours(),
        }),
      )
    const key = async (value: string, editable: boolean, type = 'keydown') => {
      const event = new Event(type, { cancelable: true })
      Object.defineProperties(event, {
        key: { value },
        target: {
          value: editable
            ? { tagName: 'TEXTAREA', closest: () => ({ tagName: 'TEXTAREA' }) }
            : target,
        },
        altKey: { value: value === 'Alt' },
        ctrlKey: { value: false },
        metaKey: { value: false },
      })
      await act(async () => {
        target.dispatchEvent(event)
        flushFrames()
      })
      return event
    }
    expect((await key('r', false)).defaultPrevented).toBe(true)
    expect(mesh.rotation.y).toBeCloseTo(0.25 + Math.PI / 4)
    expect(colours()).toContain(0xef4444)
    const before = snapshot()
    expect(before.live.length).toBeGreaterThan(0)
    expect(before.history.past.length).toBeGreaterThan(0)
    expect(before.history.tracking).toBe(false)
    expect(before.scope.kind).toBe('moving')
    for (const value of ['r', 't', 'Alt']) {
      expect((await key(value, true)).defaultPrevented).toBe(false)
      expect(snapshot()).toEqual(before)
    }
    // Key-up reset remains active even if focus moved into a field.
    await key('Alt', false)
    expect(colours()).toContain(0x22c55e)
    await key('Alt', true, 'keyup')
    expect(colours()).toContain(0xef4444)
    expect((await key('t', false)).defaultPrevented).toBe(true)
    expect(mesh.rotation.y).toBeCloseTo(0.25)
    expect(core.useLiveTransforms.getState().transforms.get(id)?.rotation).toBeCloseTo(0.25)
  } finally {
    if (root)
      await act(async () => {
        root!.unmount()
      })
    // R3F's delayed disposal is advanced, not slept through, before globals go.
    jest.runOnlyPendingTimers()
    frames.clear()
    restoreRegistry()
    core.sceneRegistry.nodes.clear()
    for (const [key, value] of sceneObjects) core.sceneRegistry.nodes.set(key, value)
    stores.forEach((store, index) => {
      ;(store.setState as (snapshot: unknown, replace: true) => void)(originalStates[index], true)
    })
    mesh.geometry.dispose()
    mesh.material.dispose()
    jest.useRealTimers()
    globals.forEach((key, index) => {
      const descriptor = descriptors[index]
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else Reflect.deleteProperty(globalThis, key)
    })
  }
}, 15_000)

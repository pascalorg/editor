import { expect, spyOn, test } from 'bun:test'
import {
  CeilingNode,
  emitter,
  type GridEvent,
  nodeRegistry,
  registerNode,
  SlabNode,
  useRegistry,
  WallNode,
} from '@pascal-app/core'
import { hideFromScene, showInScene, useViewer } from '@pascal-app/viewer'
import { _roots, act, createRoot } from '@react-three/fiber'
import { createElement } from 'react'
import {
  DoubleSide,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  type WebGLRenderer,
} from 'three'
import { DRAFTING_SURFACE_EXTENSION_KEY } from '../lib/interaction/registered-drafting'
import useInteractionScope from '../store/use-interaction-scope'
import { useGridEvents } from './use-grid-events'

test('grid moves throttle camera drags at 100 ms and resume immediately during tool drags', async () => {
  const previousViewer = useViewer.getState()
  const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
  const previousAct = actGlobal.IS_REACT_ACT_ENVIRONMENT
  actGlobal.IS_REACT_ACT_ENVIRONMENT = true
  let now = 0
  const clock = spyOn(performance, 'now').mockImplementation(() => now)
  let rectReads = 0
  const canvas = Object.assign(new EventTarget(), {
    getBoundingClientRect() {
      rectReads++
      return { left: 0, top: 0, width: 100, height: 100 }
    },
  }) as unknown as HTMLCanvasElement
  const root = createRoot(canvas)
  const camera = new PerspectiveCamera(60, 1, 0.1, 100)
  camera.position.set(0, 10, 10)
  camera.lookAt(0, 0, 0)
  camera.updateMatrixWorld()
  const delivered: GridEvent[] = []
  const onMove = (event: GridEvent) => delivered.push(event)
  emitter.on('grid:move', onMove)

  function Grid() {
    useGridEvents(5)
    return null
  }

  const send = (clientX = 50) => {
    canvas.dispatchEvent(
      Object.assign(new Event('pointermove'), { clientX, clientY: 50, button: 0 }),
    )
  }

  try {
    useViewer.setState({
      cameraDragging: false,
      inputDragging: false,
      selection: { buildingId: null, levelId: null, zoneId: null, selectedIds: [] },
    })
    await root.configure({
      gl: {
        domElement: canvas,
        render() {},
        setSize() {},
        setPixelRatio() {},
      } as unknown as WebGLRenderer,
      camera,
      frameloop: 'never',
      dpr: 1,
      size: { width: 100, height: 100, top: 0, left: 0 },
    })
    await act(async () => {
      root.render(createElement(Grid))
    })
    send()
    expect(rectReads).toBe(1)
    expect(delivered).toHaveLength(1)
    const initial = delivered[0]!
    expect(initial.position[1]).toBeCloseTo(5)
    expect(initial.localPosition).toEqual(initial.position)

    for (const inputDragging of [false, true]) {
      const before = delivered.length
      useViewer.setState({ cameraDragging: true, inputDragging })
      send(55)
      expect(delivered).toHaveLength(before + 1)
      for (now = 1; now < 100; now++) send(60)
      expect(rectReads).toBe(before + 1)
      expect(delivered).toHaveLength(before + 1)

      now = 100
      send(60)
      expect(delivered).toHaveLength(before + 2)
      expect(delivered.at(-1)!.position).not.toEqual(delivered.at(-2)!.position)
      now = 101
      useViewer.setState({ cameraDragging: false })
      send()
      expect(delivered).toHaveLength(before + 3)
      expect(rectReads).toBe(delivered.length)
      expect(delivered.at(-1)!.position).toEqual(initial.position)
      expect(delivered.at(-1)!.localPosition).toEqual(initial.localPosition)
      now = 0
    }

    await act(async () => {
      root.render(null)
    })
    const before = delivered.length
    send()
    expect(delivered).toHaveLength(before)
    expect(rectReads).toBe(before)
  } finally {
    await act(async () => {
      root.render(null)
    })
    clock.mockRestore()
    emitter.off('grid:move', onMove)
    _roots.delete(canvas)
    useViewer.setState(previousViewer)
    actGlobal.IS_REACT_ACT_ENVIRONMENT = previousAct
  }
})

test.each([
  'slab',
  'ceiling',
] as const)('grid moves keep the same %s hit when its source joins or leaves a batch', async (kind) => {
  const previousViewer = useViewer.getState()
  const previousScope = useInteractionScope.getState().scope
  const restoreRegistry = nodeRegistry._snapshot()
  const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
  const previousAct = actGlobal.IS_REACT_ACT_ENVIRONMENT
  actGlobal.IS_REACT_ACT_ENVIRONMENT = true
  const canvas = Object.assign(new EventTarget(), {
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 }),
  }) as unknown as HTMLCanvasElement
  const root = createRoot(canvas)
  const camera = new PerspectiveCamera(60, 1, 0.1, 100)
  camera.position.set(0, kind === 'ceiling' ? 1 : 10, 10)
  camera.lookAt(0, 5, 0)
  camera.updateMatrixWorld()
  const surface = new Mesh(
    new PlaneGeometry(20, 20).rotateX(-Math.PI / 2),
    new MeshBasicMaterial({ side: DoubleSide }),
  )
  surface.position.y = 5
  surface.updateMatrixWorld(true)
  const surfaceId = `${kind}_grid_batch_test` as const
  const wall = WallNode.parse({ start: [0, 0], end: [0, 2] })
  const delivered: GridEvent[] = []
  const onMove = (event: GridEvent) => delivered.push(event)
  emitter.on('grid:move', onMove)

  function Grid() {
    useRegistry(surfaceId, kind, { current: surface })
    useGridEvents(0)
    return null
  }
  const send = () => {
    const before = delivered.length
    canvas.dispatchEvent(
      Object.assign(new Event('pointermove'), { clientX: 55, clientY: 50, button: 0 }),
    )
    expect(delivered).toHaveLength(before + 1)
    return delivered.at(-1)!
  }

  try {
    nodeRegistry._reset()
    registerNode({
      kind,
      schemaVersion: 1,
      category: 'structure',
      capabilities: {},
      schema: kind === 'ceiling' ? CeilingNode : SlabNode,
      defaults: () => ({}),
      drafting: { surfaceQuery: true },
      extensions: {
        [DRAFTING_SURFACE_EXTENSION_KEY]: {
          kind,
          ...(kind === 'ceiling' ? { raycast: 'underside' } : {}),
        },
      },
    })
    useViewer.setState({
      cameraDragging: false,
      selection: { buildingId: null, levelId: null, zoneId: null, selectedIds: [] },
    })
    await root.configure({
      gl: {
        domElement: canvas,
        render() {},
        setSize() {},
        setPixelRatio() {},
      } as unknown as WebGLRenderer,
      camera,
      frameloop: 'never',
      dpr: 1,
      size: { width: 100, height: 100, top: 0, left: 0 },
    })
    for (const scope of [
      { kind: 'moving', node: wall, nodeId: wall.id, nodeType: 'wall', view: '3d' },
      { kind: 'drafting', tool: kind },
    ] as const) {
      await act(async () => {
        useInteractionScope.setState({ scope })
        root.render(createElement(Grid))
      })
      const before = send()
      expect(before.surfaceHit?.hostId).toBe(surfaceId)
      expect(before.position[1]).toBeCloseTo(5)
      hideFromScene(surface, 'batched')
      const batched = send()
      expect(batched.surfaceHit).toEqual(before.surfaceHit)
      expect(batched.position).toEqual(before.position)
      expect(batched.localPosition).toEqual(before.localPosition)
      showInScene(surface, 'batched')
      expect(send().position).toEqual(before.position)
    }
  } finally {
    await act(async () => {
      root.render(null)
    })
    emitter.off('grid:move', onMove)
    _roots.delete(canvas)
    surface.geometry.dispose()
    surface.material.dispose()
    restoreRegistry()
    useInteractionScope.setState({ scope: previousScope })
    useViewer.setState(previousViewer)
    actGlobal.IS_REACT_ACT_ENVIRONMENT = previousAct
  }
})

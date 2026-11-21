import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  BuildingNode,
  LevelNode,
  registerPointAskHandler,
  sceneRegistry,
  useScene,
  WallNode,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { Mesh, MeshBasicMaterial, OrthographicCamera, PlaneGeometry, Raycaster } from 'three'
import {
  getEditorThreeContext,
  setEditorThreeContext,
} from '../../components/editor/three-context-bridge'
import useEditor from '../../store/use-editor'
import { usePointAsk } from '../../store/use-point-ask'
import { sendBubble, startPointAskSession } from './session'

// Owner's 18 November contract: a dragged area belongs to its centre surface, not the
// release corner/floor. An 8 × 6 m orthographic view at 100 px/m makes the oracle analytical.
// Real session, scene pick, raycaster and stores; only the browser event/viewport boundary
// is supplied here. No renderer, crop encoding, database or model is exercised.
const building = BuildingNode.parse({ id: 'building_anchor' })
const level = LevelNode.parse({ id: 'level_anchor', parentId: building.id })
const wall = WallNode.parse({
  id: 'wall_anchor',
  parentId: level.id,
  start: [-4, 2],
  end: [4, 2],
  height: 4,
})
building.children = [level.id]
level.children = [wall.id]
const initialScene = useScene.getState()
const initialViewer = useViewer.getState()
const initialPoint = usePointAsk.getState()
const initialEditor = useEditor.getState()
const initialThree = getEditorThreeContext()
const initialWall = sceneRegistry.nodes.get(wall.id)
const globalNames = ['window', 'document', 'requestAnimationFrame', 'cancelAnimationFrame']
const initialGlobals = new Map(
  globalNames.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]),
)
const camera = new OrthographicCamera(-4, 4, 3, -3, 0.1, 100)
const surface = new Mesh(new PlaneGeometry(8, 6), new MeshBasicMaterial())
const canvas = {
  style: { cursor: '' },
  getBoundingClientRect: () => ({
    left: 100,
    top: 50,
    right: 900,
    bottom: 650,
    width: 800,
    height: 600,
  }),
} as unknown as HTMLCanvasElement
let events: EventTarget
let stop = () => {}
let unregister = () => {}

beforeEach(() => {
  events = new EventTarget()
  Object.defineProperties(globalThis, {
    window: { configurable: true, value: events, writable: true },
    document: { configurable: true, value: new EventTarget(), writable: true },
    requestAnimationFrame: { configurable: true, value: () => 0, writable: true },
    cancelAnimationFrame: { configurable: true, value: () => {}, writable: true },
  })
  useScene.setState({
    nodes: { [building.id]: building, [level.id]: level, [wall.id]: wall },
    rootNodeIds: [building.id],
    dirtyNodes: new Set(),
    readOnly: false,
  })
  useViewer.setState({
    projectId: null,
    selection: { ...initialViewer.selection, levelId: level.id, selectedIds: [] },
  })
  useEditor.setState({ phase: 'building', workspaceMode: 'edit', isFirstPersonMode: false })
  usePointAsk.setState({
    ...initialPoint,
    active: true,
    latched: true,
    playful: false,
    pins: {},
    pinOrder: [],
    hover: null,
    bubble: null,
    region: null,
  })
  camera.position.set(0, 2, 10)
  camera.lookAt(0, 2, 2)
  camera.updateMatrixWorld(true)
  surface.position.set(0, 2, 2)
  surface.updateMatrixWorld(true)
  sceneRegistry.nodes.set(wall.id, surface)
  setEditorThreeContext({ camera, raycaster: new Raycaster(), domElement: canvas })
  unregister = registerPointAskHandler(async () => ({ ok: true }))
  stop = startPointAskSession()
})

afterEach(() => {
  stop()
  unregister()
  setEditorThreeContext(initialThree)
  if (initialWall) sceneRegistry.nodes.set(wall.id, initialWall)
  else sceneRegistry.nodes.delete(wall.id)
  useScene.setState(initialScene, true)
  useViewer.setState(initialViewer, true)
  useEditor.setState(initialEditor, true)
  usePointAsk.setState(initialPoint, true)
  for (const [name, descriptor] of initialGlobals) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor)
    else Reflect.deleteProperty(globalThis, name)
  }
})

function pointer(type: string, x: number, y: number) {
  const event = new Event(type, { cancelable: true })
  Object.defineProperties(event, {
    target: { value: canvas },
    clientX: { value: x },
    clientY: { value: y },
    button: { value: 0 },
    pointerType: { value: 'touch' },
    shiftKey: { value: false },
  })
  events.dispatchEvent(event)
}

function expectPoint(actual: readonly number[] | undefined, expected: readonly number[]) {
  expect(actual).toHaveLength(3)
  for (const [axis, value] of expected.entries()) {
    const coordinate = actual?.[axis]
    if (coordinate === undefined) throw new Error(`Missing coordinate ${axis}`)
    expect(coordinate).toBeCloseTo(value, 8)
  }
}

async function plantedPin() {
  await sendBubble('Inspect this surface', { x: 500, y: 350, width: 100, height: 30 })
  const askId = usePointAsk.getState().pinOrder.at(-1)
  if (!askId) throw new Error('Sending the captured view did not plant a pin')
  const pin = usePointAsk.getState().pins[askId]
  if (!pin) throw new Error('The planted pin is missing')
  return pin
}

describe('captured surface anchoring through pointer gestures', () => {
  for (const reverse of [false, true])
    test(`${reverse ? 'reverse' : 'forward'} drag plants at the surface centre and keeps its four corners after send`, async () => {
      const start = reverse ? ([700, 500] as const) : ([300, 200] as const)
      const end = reverse ? ([300, 200] as const) : ([700, 500] as const)
      pointer('pointerdown', start[0], start[1])
      pointer('pointermove', end[0], end[1])
      pointer('pointerup', end[0], end[1])
      const bubble = usePointAsk.getState().bubble
      expect(bubble?.gesture).toBe('region')
      expectPoint(bubble?.anchor, [0, 2, 2])
      expectPoint(bubble?.hit.point, [0, 2, 2])
      expectPoint(bubble?.hit.normal, [0, 0, 1])
      const footprint = bubble?.footprint
      expectPoint(footprint?.center, [0, 2, 2])
      expectPoint(footprint?.normal, [0, 0, 1])
      expect(footprint?.corners).toHaveLength(4)
      // Order is not contractual; each rectangle corner must lie on the captured wall.
      for (const corner of [
        [-2, 3.5, 2],
        [2, 3.5, 2],
        [2, 0.5, 2],
        [-2, 0.5, 2],
      ]) {
        expect(
          footprint?.corners.some((actual) =>
            actual.every((coordinate, axis) => Math.abs(coordinate - (corner[axis] ?? 0)) < 1e-8),
          ),
        ).toBe(true)
      }
      const pin = await plantedPin()
      expectPoint(pin.anchor, [0, 2, 2])
      expect(pin.footprint).toEqual(footprint)
      expect(usePointAsk.getState().bubble).toBeNull()
    })

  test('a point pin remains at the exact hit, not the wall centre or the level floor', async () => {
    pointer('pointerdown', 350, 250)
    pointer('pointerup', 350, 250)
    expect(usePointAsk.getState().bubble?.gesture).toBe('click')
    expectPoint(usePointAsk.getState().bubble?.anchor, [-1.5, 3, 2])
    const pin = await plantedPin()
    expectPoint(pin.anchor, [-1.5, 3, 2])
    expect(pin.footprint).toBeUndefined()
    expectPoint(pin.submit?.context.targets[0]?.hit?.point, [-1.5, 3, 2])
  })

  test('empty clicks are ignored by default, but freeClick places a comment anywhere on the floor plane', async () => {
    // Move the wall out of the way and point the camera straight down at the level floor.
    sceneRegistry.nodes.delete(wall.id)
    const prevUp = camera.up.clone()
    camera.up.set(0, 0, -1)
    camera.position.set(0, 10, 0)
    camera.lookAt(0, 0, 0)
    camera.updateMatrixWorld(true)

    try {
      // Default mode (freeClick = false): clicking empty space opens nothing.
      pointer('pointerdown', 500, 350)
      pointer('pointerup', 500, 350)
      expect(usePointAsk.getState().bubble).toBeNull()

      // Restart session with freeClick: true.
      stop()
      stop = startPointAskSession({ freeClick: true })
      usePointAsk.setState({ active: true, latched: true })
      pointer('pointerdown', 600, 250)
      pointer('pointerup', 600, 250)
      const bubble = usePointAsk.getState().bubble
      expect(bubble?.gesture).toBe('click')
      expect(bubble?.targets).toEqual([])
      expectPoint(bubble?.anchor, [1, 0, -1])
      const pin = await plantedPin()
      expectPoint(pin.anchor, [1, 0, -1])
      expect(pin.model.targetIds).toEqual([])
    } finally {
      camera.up.copy(prevUp)
    }
  })
})

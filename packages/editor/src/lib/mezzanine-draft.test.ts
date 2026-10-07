import { afterAll, afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  type AnyNode,
  area,
  BuildingNode,
  clearSceneHistory,
  createZone,
  generateId,
  initSpaceDetectionSync,
  LevelNode,
  useScene,
  type ZoneNode,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { createElement } from 'react'
import {
  bindFloorRegionPointer,
  FloorRegionControls3D,
  resolveFloorRegionRoom,
} from '../components/editor/floor-region-controls'
import useEditor from '../store/use-editor'
import useInteractionScope from '../store/use-interaction-scope'
import { withSelectionHarness } from '../test-utils/selection-harness'
import {
  finishFloorRegion,
  moveFloorRegion,
  pressFloorRegion,
  releaseFloorRegion,
  removeLastFloorRegionPoint,
  useFloorRegionDraft,
} from './floor-region-session'
import type { FloorRegionPoint, FloorRegionSnapSettings } from './floor-region-snap'
import { hasLiveGestures, liveGestureKinds } from './gesture-lifecycle'
import {
  cancelMezzanineDraft,
  MEZZANINE_DRAFT_HANDLE,
  setMezzanineShape,
  startMezzanineDraft,
  useMezzanineDraft,
} from './mezzanine-draft'
import {
  MEZZANINE_ELEVATION_MESSAGE,
  MEZZANINE_OUTSIDE_MESSAGE,
  MEZZANINE_OVERLAP_MESSAGE,
  MEZZANINE_TOO_SMALL_MESSAGE,
} from './mezzanine-messages'
import { usePaintRegionMode } from './paint-region-mode'
import { applyRoomPlan } from './room-structure-commands'
import { sfxEmitter } from './sfx-bus'

type P = FloorRegionPoint

const LEVEL = 'level_mezzanine_draft'
const BUILDING = 'building_mezzanine_draft'
const OFF: FloorRegionSnapSettings = { mode: 'off', step: 0.5 }
const LINES: FloorRegionSnapSettings = { mode: 'lines', step: 0.5 }
const CLOSE = 0.2

let hostId: string
let stop = () => {}
const stubbed: string[] = []

const nodes = () => useScene.getState().nodes as Record<string, AnyNode>
const mezzanines = () =>
  Object.values(nodes()).filter(
    (node): node is ZoneNode => node.type === 'zone' && node.floor?.support === 'open',
  )
const history = () => useScene.temporal.getState().pastStates.length
const draft = () => useFloorRegionDraft.getState().draft
const host = () => useMezzanineDraft.getState().host!

function setup(height?: number) {
  useInteractionScope.getState().end()
  const building = BuildingNode.parse({ id: BUILDING, children: [LEVEL] })
  const level = LevelNode.parse({ id: LEVEL, parentId: building.id, ...(height ? { height } : {}) })
  useScene.setState({
    nodes: { [building.id]: building, [level.id]: level },
    rootNodeIds: [building.id],
    dirtyNodes: new Set(),
    materials: {},
    collections: {},
    readOnly: false,
  })
  useScene.temporal.getState().resume()
  stop()
  stop = initSpaceDetectionSync(useScene, { getState: () => ({ spaces: {}, setSpaces: () => {} }) })
  const plan = createZone(nodes(), {
    levelId: LEVEL,
    polygon: [
      [0, 0],
      [6, 0],
      [6, 4],
      [0, 4],
    ],
    enclose: true,
    mintId: generateId,
  })
  applyRoomPlan(plan)
  hostId = plan.zoneId
  useViewer.getState().setSelection({ buildingId: building.id, levelId: LEVEL, selectedIds: [] })
  useEditor.setState({ phase: 'building', mode: 'select', room: null })
  clearSceneHistory()
}

function rectangle(from: P, to: P, settings = OFF) {
  pressFloorRegion('rectangle', host(), from, settings, CLOSE)
  moveFloorRegion(to, settings, CLOSE)
  releaseFloorRegion(CLOSE)
}

function click(point: P, settings = OFF) {
  pressFloorRegion('polygon', host(), point, settings, CLOSE)
  releaseFloorRegion(CLOSE)
}

/** The host's clear floor (inside the wall faces): [minX, minZ, maxX, maxZ]. */
function clearBounds() {
  const ring = host().clear[0]!.outer
  const xs = ring.map(([x]) => x)
  const zs = ring.map(([, z]) => z)
  return [Math.min(...xs), Math.min(...zs), Math.max(...xs), Math.max(...zs)] as const
}

function expectArmed() {
  expect(useMezzanineDraft.getState().host?.zoneId).toBe(hostId)
  expect(liveGestureKinds()).toEqual(['mezzanine-draft'])
}

function expectIdle() {
  expect(useMezzanineDraft.getState().host).toBeNull()
  expect(draft()).toBeNull()
  expect(hasLiveGestures()).toBe(false)
  expect(useInteractionScope.getState().scope.kind).toBe('idle')
}

beforeEach(() => {
  globalThis.requestAnimationFrame ??= (callback) => {
    callback(0)
    return 0
  }
  globalThis.cancelAnimationFrame ??= () => {}
  if (!globalThis.window) {
    globalThis.window = new EventTarget() as Window & typeof globalThis
    stubbed.push('window')
  }
  useMezzanineDraft.setState({ host: null, shape: 'rectangle' })
  useFloorRegionDraft.setState({ draft: null, hover: null })
  setup()
})
afterEach(() => {
  cancelMezzanineDraft()
  stop()
  stop = () => {}
})
afterAll(async () => {
  await new Promise((resolve) => setTimeout(resolve, 350))
  for (const key of stubbed.splice(0)) delete (globalThis as Record<string, unknown>)[key]
})

describe('starting the mezzanine draft', () => {
  test('opens with the shape picked in the room panel', () => {
    expect(startMezzanineDraft(hostId, 'polygon')).toBe(true)
    expect(useMezzanineDraft.getState().shape).toBe('polygon')
    cancelMezzanineDraft()
    expect(startMezzanineDraft(hostId)).toBe(true)
    expect(useMezzanineDraft.getState().shape).toBe('rectangle')
  })

  test('selects the room and its level first, then claims its own scope', () => {
    useViewer.getState().setSelection({ levelId: null })
    useEditor.setState({ mode: 'material-paint' })
    expect(startMezzanineDraft(hostId)).toBe(true)
    expectArmed()
    expect(useEditor.getState().mode).toBe('select')
    expect(useEditor.getState().room).toEqual({ levelId: LEVEL, zoneId: hostId })
    expect(useViewer.getState().selection.levelId).toBe(LEVEL)
    expect(useInteractionScope.getState().scope).toMatchObject({
      kind: 'handle-drag',
      nodeId: hostId,
      handle: MEZZANINE_DRAFT_HANDLE,
    })
    // Drawn on the mezzanine's plane: half the default storey.
    expect(host().elevation).toBeGreaterThan(0.5)
    expect(history()).toBe(0)
  })

  test('refuses what cannot host one without touching anything', () => {
    expect(startMezzanineDraft('zone_missing')).toBe(false)
    expect(startMezzanineDraft(LEVEL)).toBe(false)
    expectIdle()
    expect(useEditor.getState().room).toBeNull()
  })
})

describe('drawing a mezzanine', () => {
  test('rectangle: one mezzanine hosted by the room, one undo step, then selected', () => {
    startMezzanineDraft(hostId)
    rectangle([1, 1], [3, 3])
    const [mezzanine] = mezzanines()
    expect(mezzanines()).toHaveLength(1)
    expect(mezzanine!.hostZoneId).toBe(hostId)
    expect(mezzanine!.floor?.support).toBe('open')
    expect(area([{ outer: mezzanine!.polygon, holes: [] }])).toBeCloseTo(4)
    expect(history()).toBe(1)
    expectIdle()
    expect(useEditor.getState().room).toEqual({ levelId: LEVEL, zoneId: mezzanine!.id })
  })

  test('rectangle: two clicks set opposite corners, as a Rectangle room does', () => {
    let built = 0
    const onBuild = () => built++
    sfxEmitter.on('sfx:structure-build', onBuild)
    startMezzanineDraft(hostId)
    pressFloorRegion('rectangle', host(), [1, 1], OFF, CLOSE)
    releaseFloorRegion(CLOSE)
    // The first corner is placed and the box follows the pointer; nothing is built.
    expect(draft()).toMatchObject({ kind: 'rectangle', start: [1, 1], anchored: true })
    expect(mezzanines()).toEqual([])
    expectArmed()
    moveFloorRegion([2.5, 2], OFF, CLOSE)
    expect(draft()).toMatchObject({ start: [1, 1], end: [2.5, 2] })
    pressFloorRegion('rectangle', host(), [3, 3], OFF, CLOSE)
    releaseFloorRegion(CLOSE)
    expect(mezzanines()).toHaveLength(1)
    expect(area([{ outer: mezzanines()[0]!.polygon, holes: [] }])).toBeCloseTo(4)
    expect(history()).toBe(1)
    expectIdle()
    sfxEmitter.off('sfx:structure-build', onBuild)
    expect(built).toBe(1)
  })

  test('rectangle: a second click on the first corner drops the box, the tool stays armed', () => {
    startMezzanineDraft(hostId)
    pressFloorRegion('rectangle', host(), [1, 1], OFF, CLOSE)
    releaseFloorRegion(CLOSE)
    pressFloorRegion('rectangle', host(), [1, 1], OFF, CLOSE)
    releaseFloorRegion(CLOSE)
    expect(draft()).toBeNull()
    expect(mezzanines()).toEqual([])
    expectArmed()
  })

  test('the default elevation is half the storey, as previewed', () => {
    startMezzanineDraft(hostId)
    const previewed = host().elevation
    rectangle([1, 1], [3, 3])
    expect(mezzanines()[0]!.floor?.elevation).toBe(previewed)
  })

  test('polygon: points, Backspace, close on the first point commits once', () => {
    startMezzanineDraft(hostId)
    setMezzanineShape('polygon')
    click([1, 1])
    click([4, 1])
    click([5, 3])
    expect(removeLastFloorRegionPoint()).toBe(true)
    click([4, 3])
    click([1, 3])
    click([1.05, 1.05])
    expect(mezzanines()).toHaveLength(1)
    expect(area([{ outer: mezzanines()[0]!.polygon, holes: [] }])).toBeCloseTo(6)
    expect(history()).toBe(1)
    expectIdle()
  })

  test('polygon: Enter closes; Backspace past the first point keeps the tool armed', () => {
    startMezzanineDraft(hostId)
    setMezzanineShape('polygon')
    click([1, 1])
    expect(removeLastFloorRegionPoint()).toBe(true)
    expect(draft()).toBeNull()
    expectArmed()
    click([1, 1])
    click([3, 1])
    click([3, 3])
    expect(finishFloorRegion()).toBe(true)
    expect(mezzanines()).toHaveLength(1)
    expect(history()).toBe(1)
  })

  test("snaps to the host's clear floor: wall faces, their corners, and the grid", () => {
    startMezzanineDraft(hostId)
    const [minX, minZ, maxX] = clearBounds()
    // Near the room's inner corner (where two wall faces meet).
    pressFloorRegion('rectangle', host(), [minX + 0.03, minZ + 0.02], LINES, CLOSE)
    expect((draft() as { start: P }).start[0]).toBeCloseTo(minX)
    expect((draft() as { start: P }).start[1]).toBeCloseTo(minZ)
    // Near the inner face of the east wall.
    moveFloorRegion([maxX - 0.03, 2.5], LINES, CLOSE)
    const end = (draft() as { end: P }).end
    expect(end[0]).toBeCloseTo(maxX)
    expect(end[1]).toBeCloseTo(2.5)
    moveFloorRegion([2.8, 2.2], { mode: 'grid', step: 0.5 }, CLOSE)
    expect(draft()).toMatchObject({ end: [3, 2] })
    releaseFloorRegion(CLOSE)
    const polygon = mezzanines()[0]!.polygon
    expect(polygon.some(([x, z]) => Math.abs(x - minX) < 1e-6 && Math.abs(z - minZ) < 1e-6)).toBe(
      true,
    )
    expect(polygon).toEqual(expect.arrayContaining([[3, 2]]))
  })

  test('a box across the walls is clipped to the clear floor', () => {
    startMezzanineDraft(hostId)
    const [, , maxX, maxZ] = clearBounds()
    rectangle([4, 2], [8, 6])
    const [mezzanine] = mezzanines()
    expect(Math.max(...mezzanine!.polygon.map(([x]) => x))).toBeCloseTo(maxX)
    expect(Math.max(...mezzanine!.polygon.map(([, z]) => z))).toBeCloseTo(maxZ)
    expect(area([{ outer: mezzanine!.polygon, holes: [] }])).toBeCloseTo((maxX - 4) * (maxZ - 2))
  })
})

describe('refusals keep the tool armed and write nothing', () => {
  test('outside the room', () => {
    startMezzanineDraft(hostId)
    rectangle([7, 1], [9, 3])
    expect(draft()).toMatchObject({ kind: 'rectangle', refusal: MEZZANINE_OUTSIDE_MESSAGE })
    // A refused box stays put until the next press.
    moveFloorRegion([10, 4], OFF, CLOSE)
    expect(draft()).toMatchObject({ end: [9, 3] })
    setMezzanineShape('polygon')
    click([7, 1])
    expect(draft()).toMatchObject({ points: [], message: MEZZANINE_OUTSIDE_MESSAGE })
    // A point on the wall's inner face is inside; one on its centre line is not.
    click([0, 1])
    expect(draft()).toMatchObject({ points: [], message: MEZZANINE_OUTSIDE_MESSAGE })
    const [minX] = clearBounds()
    click([minX, 1])
    expect(draft()).toMatchObject({ points: [[minX, 1]], message: null })
    expect(mezzanines()).toEqual([])
    expect(history()).toBe(0)
    expectArmed()
  })

  test('smaller than 1 m²', () => {
    startMezzanineDraft(hostId)
    rectangle([1, 1], [1.5, 1.5])
    expect(draft()).toMatchObject({ refusal: MEZZANINE_TOO_SMALL_MESSAGE })
    setMezzanineShape('polygon')
    click([1, 1])
    click([1.8, 1])
    click([1.4, 1.6])
    expect(finishFloorRegion()).toBe(true)
    expect(draft()).toMatchObject({ refusal: MEZZANINE_TOO_SMALL_MESSAGE })
    expect(mezzanines()).toEqual([])
    expect(history()).toBe(0)
    expectArmed()
    // The next box starts fresh and commits.
    setMezzanineShape('rectangle')
    rectangle([1, 1], [3, 2])
    expect(mezzanines()).toHaveLength(1)
  })

  test('overlapping a mezzanine', () => {
    startMezzanineDraft(hostId)
    rectangle([1, 1], [3, 3])
    clearSceneHistory()
    expect(startMezzanineDraft(hostId)).toBe(true)
    rectangle([2, 2], [4, 3.5])
    expect(draft()).toMatchObject({ refusal: MEZZANINE_OVERLAP_MESSAGE })
    expect(mezzanines()).toHaveLength(1)
    expect(history()).toBe(0)
    // Butting against it snaps onto its edge and commits.
    pressFloorRegion('rectangle', host(), [3.04, 1], LINES, CLOSE)
    moveFloorRegion([5, 3], OFF, CLOSE)
    releaseFloorRegion(CLOSE)
    expect(mezzanines()).toHaveLength(2)
  })

  test('too high or too low for the storey', () => {
    cancelMezzanineDraft()
    setup(0.5)
    startMezzanineDraft(hostId)
    rectangle([1, 1], [3, 3])
    expect(draft()).toMatchObject({ refusal: MEZZANINE_ELEVATION_MESSAGE })
    expect(mezzanines()).toEqual([])
    expect(history()).toBe(0)
  })
})

describe('cancelling', () => {
  test('Escape on the bound surface cancels without writes; T leaves the picked shape', () => {
    const surface = new EventTarget()
    const keyboard = new EventTarget()
    let at: P = [1, 1]
    startMezzanineDraft(hostId, 'polygon')
    const dispose = bindFloorRegionPointer(
      surface,
      () => ({ room: host(), point: at }),
      () => CLOSE,
      keyboard,
    )
    const pointer = (type: string, target: EventTarget) =>
      target.dispatchEvent(
        Object.assign(new Event(type), { button: 0, pointerId: 1, altKey: true }),
      )
    const key = (value: string) =>
      keyboard.dispatchEvent(
        Object.assign(new Event('keydown', { cancelable: true }), { key: value }),
      )
    try {
      // The shape is picked in the room panel; T no longer switches it.
      key('t')
      expect(useMezzanineDraft.getState().shape).toBe('polygon')
      at = [1, 1]
      pointer('pointerdown', surface)
      pointer('pointerup', keyboard)
      at = [3, 1]
      pointer('pointerdown', surface)
      pointer('pointerup', keyboard)
      expect(draft()).toMatchObject({
        points: [
          [1, 1],
          [3, 1],
        ],
      })
      key('Escape')
      expectIdle()
      expect(mezzanines()).toEqual([])
      expect(history()).toBe(0)
      // Disarmed, the surface ignores the pointer.
      pointer('pointerdown', surface)
      expect(draft()).toBeNull()
    } finally {
      dispose()
      useViewer.getState().setInputDragging(false)
    }
  })

  test('the lifecycle cancels on a selection, level or mode change', () => {
    const changes = [
      () => useViewer.getState().setSelection({ selectedIds: [hostId as ZoneNode['id']] }),
      () => useViewer.getState().setSelection({ levelId: null }),
      () => useEditor.getState().setMode('delete'),
      () => useEditor.getState().clearRoom(),
    ]
    for (const change of changes) {
      setup()
      startMezzanineDraft(hostId)
      setMezzanineShape('polygon')
      click([1, 1])
      click([3, 1])
      change()
      expectIdle()
      expect(mezzanines()).toEqual([])
      setMezzanineShape('rectangle')
    }
  })

  test('paint regions still paint the floor, not a mezzanine', () => {
    startMezzanineDraft(hostId)
    cancelMezzanineDraft()
    useEditor.setState({
      mode: 'material-paint',
      activePaintMaterial: { materialPreset: 'library:tile', sourceTarget: 'wall' } as never,
    })
    usePaintRegionMode.getState().setMode('rectangle')
    try {
      const room = resolveFloorRegionRoom(LEVEL, [2, 2])!
      expect(room.purpose).toBeUndefined()
      pressFloorRegion('rectangle', room, [1, 1], OFF, CLOSE)
      moveFloorRegion([3, 3], OFF, CLOSE)
      releaseFloorRegion(CLOSE)
      const zone = nodes()[hostId] as ZoneNode
      expect(zone.floor?.regions).toHaveLength(1)
      expect(mezzanines()).toEqual([])
      expect(history()).toBe(1)
      expect(hasLiveGestures()).toBe(false)
    } finally {
      usePaintRegionMode.getState().setMode('surface')
      useEditor.setState({ mode: 'select', activePaintMaterial: null })
    }
  })

  test('the last drawing surface unmounting disarms the tool before any press', async () => {
    await withSelectionHarness(async ({ render }) => {
      await render(createElement(FloorRegionControls3D))
      expect(startMezzanineDraft(hostId)).toBe(true)
      expectArmed()
      expect(draft()).toBeNull()
      await render(null)
      expect(useMezzanineDraft.getState().host).toBeNull()
      expect(hasLiveGestures()).toBe(false)
      expect(useInteractionScope.getState().scope.kind).toBe('idle')
    })
  })
})

describe('elevation', () => {
  test('commits the previewed height even when the storey changes while armed', () => {
    setup(5)
    startMezzanineDraft(hostId)
    const previewed = host().elevation
    expect(previewed).toBeCloseTo(2.5)
    useScene.getState().updateNode(LEVEL as never, { height: 8 } as never)
    rectangle([0, 0], [3, 2])
    const [mezzanine] = mezzanines()
    expect(mezzanine?.floor?.elevation).toBeCloseTo(previewed)
  })
})

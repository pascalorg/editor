import { afterAll, afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  type AnyNode,
  type AnyNodeId,
  BuildingNode,
  clearSceneHistory,
  createMezzanine,
  createZone,
  generateId,
  initSpaceDetectionSync,
  LevelNode,
  type Point,
  type StairNode,
  syncAutoStairOpenings,
  useScene,
  type ZoneNode,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { roomTransformSource } from '../components/editor/room-controls'
import { runHistoryShortcut } from '../hooks/use-keyboard'
import { getRoomSelectionIndex } from '../hooks/use-selected-room'
import useEditor from '../store/use-editor'
import useInteractionScope from '../store/use-interaction-scope'
import { cancelGestures, hasLiveGestures } from './gesture-lifecycle'
import {
  MEZZANINE_NO_STAIR_MESSAGE,
  MEZZANINE_OUTSIDE_MESSAGE,
  MEZZANINE_OVERLAP_MESSAGE,
} from './mezzanine-messages'
import { addMezzanineStairs } from './mezzanine-stairs'
import {
  mezzanineEdgeHandles,
  planMezzanineEdge,
  runMezzanineEdgeDrag,
  useRoomHandleDrag,
} from './room-handle-drag'
import { applyRoomPlan } from './room-structure-commands'
import {
  cancelRoomTransform,
  commitRoomTransform,
  previewRoomTransform,
  rotateRoom,
  startRoomTransform,
  useRoomTransform,
} from './room-transform-session'

// A mezzanine picked up, turned, copied, pushed at an edge and given stairs:
// core refuses what leaves its host or overlaps another mezzanine, and every
// accepted action is one undo step that keeps the host link.

const LEVEL = 'level_mezzanine_actions'
const saved = {
  window: globalThis.window,
  document: globalThis.document,
  raf: globalThis.requestAnimationFrame,
  caf: globalThis.cancelAnimationFrame,
}
let hostId = ''
let mezzanineId = ''
let stop = () => {}

const nodes = () => useScene.getState().nodes as Record<string, AnyNode>
const zone = (id: string) => nodes()[id as AnyNodeId] as ZoneNode
const mezzanines = () =>
  Object.values(nodes()).filter(
    (node): node is ZoneNode => node.type === 'zone' && node.floor?.support === 'open',
  )
const history = () => useScene.temporal.getState().pastStates.length
const bounds = (polygon: readonly Point[]) => {
  const xs = polygon.map(([x]) => x)
  const zs = polygon.map(([, z]) => z)
  return [Math.min(...xs), Math.min(...zs), Math.max(...xs), Math.max(...zs)]
}

function addMezzanine(polygon: Point[]) {
  const plan = createMezzanine(nodes(), { hostZoneId: hostId, polygon, mintId: generateId })
  expect(plan.conflicts ?? []).toEqual([])
  applyRoomPlan(plan)
  return plan.zoneId
}

function mezzanineRecord(id = mezzanineId) {
  return getRoomSelectionIndex(LEVEL)
    .update(nodes())
    .find((room) => room.zoneId === id)!
}

beforeEach(() => {
  cancelGestures('cancel')
  globalThis.window = new EventTarget() as Window & typeof globalThis
  globalThis.document = { body: { style: { cursor: '' } } } as unknown as Document
  globalThis.requestAnimationFrame = ((callback: (time: number) => void) => {
    callback(0)
    return 0
  }) as typeof requestAnimationFrame
  globalThis.cancelAnimationFrame = (() => {}) as typeof cancelAnimationFrame
  useInteractionScope.getState().end()
  const building = BuildingNode.parse({ id: 'building_mezzanine_actions', children: [LEVEL] })
  const level = LevelNode.parse({ id: LEVEL, parentId: building.id, height: 5 })
  useScene.setState({
    nodes: { [building.id]: building, [level.id]: level },
    rootNodeIds: [building.id],
    dirtyNodes: new Set(),
    materials: {},
    collections: {},
    readOnly: false,
  })
  useScene.temporal.getState().resume()
  stop = initSpaceDetectionSync(useScene, { getState: () => ({ spaces: {}, setSpaces: () => {} }) })
  const host = createZone(nodes(), {
    levelId: LEVEL,
    polygon: [
      [0, 0],
      [8, 0],
      [8, 6],
      [0, 6],
    ],
    enclose: true,
    mintId: generateId,
  })
  applyRoomPlan(host)
  hostId = host.zoneId
  mezzanineId = addMezzanine([
    [1, 1],
    [4, 1],
    [4, 3],
    [1, 3],
  ])
  useViewer.getState().setSelection({ buildingId: building.id, levelId: LEVEL, selectedIds: [] })
  useEditor.setState({
    phase: 'building',
    mode: 'select',
    room: { levelId: LEVEL, zoneId: mezzanineId },
    gridSnapStep: 0.5,
  })
  clearSceneHistory()
})

afterEach(() => {
  cancelRoomTransform()
  cancelGestures('cancel')
  stop()
})

afterAll(async () => {
  await new Promise((resolve) => setTimeout(resolve, 350))
  globalThis.window = saved.window
  globalThis.document = saved.document
  globalThis.requestAnimationFrame = saved.raf
  globalThis.cancelAnimationFrame = saved.caf
})

describe('moving a mezzanine', () => {
  test('inside its host it commits in one step, keeping the host link', () => {
    expect(startRoomTransform('move', roomTransformSource(mezzanineRecord()))).toBe(true)
    previewRoomTransform([2, 1], 0)
    expect(useRoomTransform.getState().session).toMatchObject({ valid: true })
    expect(commitRoomTransform()).toBe(true)
    expect(bounds(zone(mezzanineId).polygon)).toEqual([3, 2, 6, 4])
    expect(zone(mezzanineId).hostZoneId).toBe(hostId)
    expect(history()).toBe(1)
  })

  test('outside the host or onto another mezzanine it turns red with the mezzanine label', () => {
    addMezzanine([
      [5, 3.5],
      [7.5, 3.5],
      [7.5, 5.5],
      [5, 5.5],
    ])
    clearSceneHistory()
    startRoomTransform('move', roomTransformSource(mezzanineRecord()))
    previewRoomTransform([6, 0], 0)
    expect(useRoomTransform.getState().session).toMatchObject({
      valid: false,
      message: MEZZANINE_OUTSIDE_MESSAGE,
    })
    expect(commitRoomTransform()).toBe(false)
    previewRoomTransform([1.5, 1], 0)
    expect(useRoomTransform.getState().session).toMatchObject({
      valid: false,
      message: MEZZANINE_OVERLAP_MESSAGE,
    })
    expect(commitRoomTransform()).toBe(false)
    expect(history()).toBe(0)
  })
})

describe('turning and copying a mezzanine', () => {
  test('rotate left turns it about its centre in one step; a turn that leaves the room says why', () => {
    expect(rotateRoom({ levelId: LEVEL, zoneId: mezzanineId }, 'left').ok).toBe(true)
    const [minX, minZ, maxX, maxZ] = bounds(zone(mezzanineId).polygon)
    expect(maxX! - minX!).toBeCloseTo(2)
    expect(maxZ! - minZ!).toBeCloseTo(3)
    expect(history()).toBe(1)
    // A long thin mezzanine along the room cannot turn across it.
    const long = addMezzanine([
      [0.5, 4.2],
      [7.5, 4.2],
      [7.5, 5.5],
      [0.5, 5.5],
    ])
    clearSceneHistory()
    const refused = rotateRoom({ levelId: LEVEL, zoneId: long }, 'right')
    expect(refused).toMatchObject({ ok: false })
    expect(useRoomTransform.getState().notice?.zoneId).toBe(long)
    expect(history()).toBe(0)
  })

  test('duplicate places a copy hosted by the same room in one step', () => {
    startRoomTransform('duplicate', roomTransformSource(mezzanineRecord()))
    previewRoomTransform([0, 0], 0)
    expect(useRoomTransform.getState().session).toMatchObject({
      valid: false,
      message: MEZZANINE_OVERLAP_MESSAGE,
    })
    previewRoomTransform([3.5, 0], 0)
    expect(useRoomTransform.getState().session).toMatchObject({ valid: true })
    expect(commitRoomTransform()).toBe(true)
    expect(mezzanines()).toHaveLength(2)
    expect(mezzanines().every((node) => node.hostZoneId === hostId)).toBe(true)
    expect(history()).toBe(1)
  })
})

describe('pushing a mezzanine edge', () => {
  test('one arrow per edge, pointing out of the mezzanine', () => {
    const handles = mezzanineEdgeHandles(nodes(), mezzanineId)
    expect(handles).toHaveLength(4)
    for (const handle of handles) {
      const plan = planMezzanineEdge(nodes(), mezzanineId, handle.edgeIndex, 0.4)
      expect(plan.conflicts ?? []).toEqual([])
      const update = plan.changes.find((change) => change.op === 'update')
      const polygon = (update as { data: { polygon: Point[] } }).data.polygon
      // Pushing outward grows the plate.
      const [a, b, c, d] = bounds(polygon)
      expect((c! - a!) * (d! - b!)).toBeGreaterThan(3 * 2)
    }
  })

  test('a drag previews the outline, refuses outside the room and commits in one step', () => {
    const east = mezzanineEdgeHandles(nodes(), mezzanineId).find(
      (handle) => handle.outward[0] > 0.9,
    )!
    let at = 0
    runMezzanineEdgeDrag({
      handle: east,
      zoneId: mezzanineId,
      levelId: LEVEL,
      from: 0,
      along: () => at,
    })
    const move = (value: number) => {
      at = value
      window.dispatchEvent(Object.assign(new Event('pointermove'), { clientX: 1, clientY: 1 }))
    }
    move(10)
    expect(useRoomHandleDrag.getState().drag).toMatchObject({
      kind: 'mezzanine-edge',
      message: MEZZANINE_OUTSIDE_MESSAGE,
    })
    move(1)
    const drag = useRoomHandleDrag.getState().drag as { message?: string; outline: Point[] }
    expect(drag.message).toBeUndefined()
    expect(bounds(drag.outline)[2]).toBeCloseTo(5)
    // Nothing is written until release.
    expect(bounds(zone(mezzanineId).polygon)[2]).toBeCloseTo(4)
    window.dispatchEvent(Object.assign(new Event('pointerup'), { clientX: 1, clientY: 1 }))
    expect(bounds(zone(mezzanineId).polygon)[2]).toBeCloseTo(5)
    expect(history()).toBe(1)
    expect(hasLiveGestures()).toBe(false)
  })

  test('a refused release writes nothing', () => {
    const east = mezzanineEdgeHandles(nodes(), mezzanineId).find(
      (handle) => handle.outward[0] > 0.9,
    )!
    let at = 0
    runMezzanineEdgeDrag({
      handle: east,
      zoneId: mezzanineId,
      levelId: LEVEL,
      from: 0,
      along: () => at,
    })
    at = 10
    window.dispatchEvent(Object.assign(new Event('pointermove'), { clientX: 1, clientY: 1 }))
    window.dispatchEvent(Object.assign(new Event('pointerup'), { clientX: 1, clientY: 1 }))
    expect(bounds(zone(mezzanineId).polygon)[2]).toBeCloseTo(4)
    expect(history()).toBe(0)
  })
})

describe('adding stairs', () => {
  test('places one stair up to the mezzanine and selects it, in one step', () => {
    const result = addMezzanineStairs(mezzanineId, 'outside')
    expect(result.ok).toBe(true)
    const stairId = (result as { stairId: string }).stairId
    expect(nodes()[stairId as AnyNodeId]?.type).toBe('stair')
    expect(useViewer.getState().selection.selectedIds).toEqual([stairId])
    expect(useEditor.getState().room).toBeNull()
    expect(history()).toBe(1)
    // The railing opens where the flight arrives, in the same step.
    const deck = Object.values(nodes()).find(
      (node) => node.type === 'slab' && node.support === 'open',
    ) as { railing?: unknown[] }
    expect(deck.railing).toHaveLength(5)
    // Core emits the same numeric values that shared history records through JSON.
    const hasNegativeZero = (value: unknown): boolean =>
      Object.is(value, -0) ||
      (Array.isArray(value)
        ? value.some(hasNegativeZero)
        : !!value && typeof value === 'object' && Object.values(value).some(hasNegativeZero))
    const stair = nodes()[stairId as AnyNodeId]!
    expect(hasNegativeZero(stair)).toBe(false)
    expect(
      Object.values(nodes()).some((node) => node.parentId === stairId && hasNegativeZero(node)),
    ).toBe(false)
    // One ⌘Z takes it away again.
    expect(runHistoryShortcut('undo')).toBe(true)
    expect(nodes()[stairId as AnyNodeId]).toBeUndefined()
    expect(Object.values(nodes()).some((node) => node.type === 'stair')).toBe(false)
  })

  test('says "No room for stairs" when no edge has free floor for a flight', () => {
    // The mezzanine fills the room: no host floor is left for a flight.
    useScene.getState().updateNode(
      mezzanineId as AnyNodeId,
      {
        polygon: [
          [0.2, 0.2],
          [7.8, 0.2],
          [7.8, 5.8],
          [0.2, 5.8],
        ],
      } as never,
    )
    clearSceneHistory()
    for (const placement of ['outside', 'inside'] as const) {
      const result = addMezzanineStairs(mezzanineId, placement)
      expect(result).toEqual({ ok: false, message: MEZZANINE_NO_STAIR_MESSAGE })
    }
    expect(Object.values(nodes()).some((node) => node.type === 'stair')).toBe(false)
    expect(history()).toBe(0)
  })

  test('inside, the flight climbs through its own deck in one step, keeping the host ceiling whole', () => {
    // Deep enough for a flight plus a landing, with free floor west of it.
    useScene.getState().updateNode(
      mezzanineId as AnyNodeId,
      {
        polygon: [
          [1.5, 1],
          [7, 1],
          [7, 4],
          [1.5, 4],
        ],
      } as never,
    )
    clearSceneHistory()
    const result = addMezzanineStairs(mezzanineId, 'inside')
    expect(result.ok).toBe(true)
    const stairId = (result as { stairId: string }).stairId
    const stair = nodes()[stairId as AnyNodeId] as StairNode
    const deck = Object.values(nodes()).find(
      (node) => node.type === 'slab' && node.support === 'open',
    )!
    expect(stair).toMatchObject({ deckSlabId: deck.id, slabOpeningMode: 'destination' })
    expect(stair.position[0]).toBeCloseTo(1.5)
    expect(useViewer.getState().selection.selectedIds).toEqual([stairId])
    expect(history()).toBe(1)
    const cut = syncAutoStairOpenings(nodes()).map((update) => update.id)
    expect(cut).toEqual([deck.id])
    expect(runHistoryShortcut('undo')).toBe(true)
    expect(nodes()[stairId as AnyNodeId]).toBeUndefined()
  })
})

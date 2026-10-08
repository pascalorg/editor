import { afterAll, afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  type AnyNodeId,
  BuildingNode,
  clearSceneHistory,
  createZone,
  createZoneDivisionContext,
  DoorNode,
  generateId,
  initSpaceDetectionSync,
  LevelNode,
  structureChangeBatch,
  useLiveNodeOverrides,
  useScene,
  WallNode,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { createElement } from 'react'
import { roomTransformSource } from '../components/editor/room-controls'
import { getRoomSelectionIndex } from '../hooks/use-selected-room'
import useEditor from '../store/use-editor'
import useInteractionScope from '../store/use-interaction-scope'
import { installImmediateAnimationFrames } from '../test-utils/immediate-animation-frames'
import { withSelectionHarness } from '../test-utils/selection-harness'
import { useGestureLifecycleOwner } from './gesture-lifecycle'
import {
  cancelRoomHandleDrag,
  commitRoomElevation,
  commitRoomPush,
  endRoomPushPreview,
  getActiveRoomHandleDrag,
  planRoomPush,
  previewRoomPush,
  roomFloorElevation,
  roomPushHandles,
  runRoomHandleDrag,
} from './room-handle-drag'
import { applyRoomPlan, renameRoom } from './room-structure-commands'
import {
  cancelRoomTransform,
  commitRoomTransform,
  previewRoomTransform,
  ROOM_MOVE_DRAG_LABEL,
  roomPivot,
  roomTransformFromPointer,
  rotateRoom,
  startRoomTransform,
  transformRoomPoint,
  useRoomTransform,
} from './room-transform-session'

let zoneId: string
let stop = () => {}
let restoreFrames = () => {}
const stubbed: string[] = []
const LEVEL = 'level_phase6'

function addRoom(polygon: [number, number][]) {
  const plan = createZone(useScene.getState().nodes, {
    levelId: LEVEL,
    polygon,
    enclose: true,
    mintId: generateId,
  })
  applyRoomPlan(plan)
  return plan.zoneId
}

function roomSpans(id: string) {
  // The planner's own view of the room boundary.
  return createZoneDivisionContext(useScene.getState().nodes, id).face!.spans
}

beforeEach(() => {
  restoreFrames = installImmediateAnimationFrames()
  // Stubs for the pick-up's cursor and window listeners, removed once the
  // file is done (after the click-swallow timers fire) so later files see the
  // real (absent) globals.
  if (!globalThis.document) {
    globalThis.document = { body: { style: { cursor: '' } } } as unknown as Document
    stubbed.push('document')
  }
  if (!globalThis.window) {
    globalThis.window = new EventTarget() as Window & typeof globalThis
    stubbed.push('window')
  }
  useInteractionScope.getState().end()
  const building = BuildingNode.parse({ id: 'building_phase6', children: [LEVEL] })
  const level = LevelNode.parse({ id: LEVEL, parentId: building.id })
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
  zoneId = addRoom([
    [0, 0],
    [6, 0],
    [6, 4],
    [0, 4],
  ])
  useViewer.getState().setSelection({ buildingId: building.id, levelId: LEVEL, selectedIds: [] })
  useEditor.setState({
    phase: 'building',
    mode: 'select',
    room: { zoneId, levelId: LEVEL },
    gridSnapStep: 0.5,
  })
  clearSceneHistory()
})
afterAll(async () => {
  await new Promise((resolve) => setTimeout(resolve, 350))
  for (const key of stubbed.splice(0)) delete (globalThis as Record<string, unknown>)[key]
})
afterEach(() => {
  stop()
  cancelRoomTransform()
  useRoomTransform.setState({ session: null })
  restoreFrames()
})

function startSession(kind: 'move' | 'duplicate') {
  const outline: [number, number][][] = [
    [
      [0, 0],
      [6, 0],
      [6, 4],
      [0, 4],
    ],
  ]
  useRoomTransform.setState({
    session: {
      kind,
      zoneId,
      levelId: LEVEL,
      pivot: roomPivot(outline),
      outline,
      walls: [],
      translate: [0, 0],
      angle: 0,
      force: false,
      valid: kind !== 'duplicate',
    },
  })
}

describe('room pick-up (Move / Duplicate / Rotate)', () => {
  test('the ghost transform mirrors the planner handedness and the centroid pivot', () => {
    const pivot = roomPivot([
      [
        [0, 0],
        [6, 0],
        [6, 4],
        [0, 4],
      ],
    ])
    expect(pivot[0]).toBeCloseTo(3)
    expect(pivot[1]).toBeCloseTo(2)
    const moved = transformRoomPoint([6, 2], pivot, Math.PI / 2, [1, 0])
    // A positive planner angle turns the plan clockwise in x/z: +x goes to -z.
    expect(moved[0]).toBeCloseTo(4)
    expect(moved[1]).toBeCloseTo(-1)
  })

  test('pointer carry: grid-stepped moves carrying the R / T angle', () => {
    expect(
      roomTransformFromPointer([0, 0], [1.2, 2.74], 0, {
        gridStep: 0.5,
        free: false,
      }),
    ).toEqual({ translate: [1, 2.5], angle: 0 })
    expect(
      roomTransformFromPointer([0, 0], [1.2, 2.74], Math.PI / 4, {
        gridStep: 0.5,
        free: true,
      }),
    ).toEqual({ translate: [1.2, 2.74], angle: Math.PI / 4 })
  })

  test('rotate left / right: a quarter turn, at once, one undo step each, walls on the grid', () => {
    const footprint = () => {
      const zone = useScene.getState().nodes[zoneId as AnyNodeId] as { polygon: [number, number][] }
      const xs = zone.polygon.map((p) => p[0])
      const zs = zone.polygon.map((p) => p[1])
      return [Math.max(...xs) - Math.min(...xs), Math.max(...zs) - Math.min(...zs)]
    }
    const onGrid = () =>
      Object.values(useScene.getState().nodes)
        .filter((n): n is WallNode => n.type === 'wall')
        .every((wall) =>
          [...wall.start, ...wall.end].every((v) => Math.abs(v / 0.5 - Math.round(v / 0.5)) < 1e-6),
        )
    clearSceneHistory()
    expect(rotateRoom({ zoneId, levelId: LEVEL }, 'left').ok).toBe(true)
    expect(footprint()[0]).toBeCloseTo(4)
    expect(footprint()[1]).toBeCloseTo(6)
    expect(onGrid()).toBe(true)
    expect(useScene.temporal.getState().pastStates).toHaveLength(1)
    expect(useEditor.getState().room).toEqual({ levelId: LEVEL, zoneId })
    expect(rotateRoom({ zoneId, levelId: LEVEL }, 'right').ok).toBe(true)
    expect(footprint()[0]).toBeCloseTo(6)
    expect(onGrid()).toBe(true)
    expect(useScene.temporal.getState().pastStates).toHaveLength(2)
    expect(useRoomTransform.getState().notice).toBeNull()
  })

  test('the pick-up carries the room outline and its walls, never a bounding box', () => {
    const lId = addRoom([
      [10, 0],
      [16, 0],
      [16, 2],
      [12, 2],
      [12, 5],
      [10, 5],
    ])
    const record = getRoomSelectionIndex(LEVEL)
      .update(useScene.getState().nodes)
      .find((room) => room.zoneId === lId)!
    const source = roomTransformSource(record)
    expect(source.outline[0]).toHaveLength(6)
    expect(source.walls).toHaveLength(record.boundaryWallIds.length)
    expect(source.walls.length).toBeGreaterThanOrEqual(6)
  })

  test('a move onto a neighbour commits: the rooms resolve and keep their names', () => {
    const neighbour = addRoom([
      [6, 0],
      [10, 0],
      [10, 4],
      [6, 4],
    ])
    renameRoom(zoneId, 'Studio')
    renameRoom(neighbour, 'Office')
    clearSceneHistory()
    startSession('move')
    previewRoomTransform([2, 0], 0)
    expect(useRoomTransform.getState().session).toMatchObject({ valid: true, message: undefined })
    expect(commitRoomTransform()).toBe(true)
    expect(useRoomTransform.getState().session).toBeNull()
    expect(useScene.temporal.getState().pastStates).toHaveLength(1)
    const names = Object.values(useScene.getState().nodes)
      .filter((n) => n.type === 'zone')
      .map((n) => n.name)
    expect(names).toContain('Studio')
    expect(names).toContain('Office')
  })

  test('a crossing through a door previews red with a short label; Alt slides the opening', () => {
    const neighbour = addRoom([
      [6, -4],
      [12, -4],
      [12, 4],
      [6, 4],
    ])
    const nodes = useScene.getState().nodes
    const host = Object.values(nodes).find(
      (n): n is WallNode =>
        n.type === 'wall' &&
        Math.abs(n.start[0] - n.end[0]) < 1e-6 &&
        Math.abs(n.start[0] - 12) < 1e-6,
    )!
    // A door on the neighbour's far wall, right where the carried room's wall will cross.
    const station = Math.abs(0 - host.start[1])
    const door = DoorNode.parse({
      id: 'door_in_the_way',
      parentId: host.id,
      wallId: host.id,
      position: [station, 0, 0],
    })
    useScene.getState().applyNodeChanges({ create: [{ node: door, parentId: host.id }] })
    expect(nodes[neighbour as AnyNodeId]).toBeDefined()
    clearSceneHistory()
    startSession('move')
    previewRoomTransform([9, 0], 0)
    const blocked = useRoomTransform.getState().session!
    expect(blocked.valid).toBe(false)
    expect(blocked.message).toBe('Door or window in the way · Alt slides it')
    expect(commitRoomTransform()).toBe(false)
    previewRoomTransform([9, 0], 0, true)
    expect(useRoomTransform.getState().session).toMatchObject({ valid: true, force: true })
    expect(commitRoomTransform()).toBe(true)
    const moved = useScene.getState().nodes.door_in_the_way as {
      position: [number, number, number]
    }
    expect(moved).toBeDefined()
    expect(Math.abs(moved.position[0] - station)).toBeGreaterThan(1e-3)
    expect(useScene.temporal.getState().pastStates).toHaveLength(1)
  })

  test('a refused Rotate says why under the pill, then clears', () => {
    const outcome = rotateRoom({ zoneId: 'zone_missing', levelId: LEVEL }, 'left')
    expect(outcome.ok).toBe(false)
    expect(useRoomTransform.getState().notice).toEqual({
      zoneId: 'zone_missing',
      message: "Can't place here",
    })
    expect(rotateRoom({ zoneId, levelId: LEVEL }, 'right').ok).toBe(true)
    expect(useRoomTransform.getState().notice).toBeNull()
  })

  test('duplicate keeps the source and selects the copy', () => {
    startSession('duplicate')
    previewRoomTransform([0, 8], 0)
    expect(useRoomTransform.getState().session).toMatchObject({ valid: true })
    expect(commitRoomTransform()).toBe(true)
    const zones = Object.values(useScene.getState().nodes).filter((n) => n.type === 'zone')
    expect(zones).toHaveLength(2)
    expect(useScene.getState().nodes[zoneId as AnyNodeId]).toBeDefined()
    expect(useEditor.getState().room?.zoneId).not.toBe(zoneId)
    expect(useScene.temporal.getState().pastStates).toHaveLength(1)
  })

  test('cancel puts it back without touching the scene', () => {
    const before = useScene.getState().nodes
    startSession('move')
    previewRoomTransform([0, 0], Math.PI / 4)
    cancelRoomTransform()
    expect(useRoomTransform.getState().session).toBeNull()
    expect(useScene.getState().nodes).toBe(before)
  })
})

describe('room handles (elevation, push/pull)', () => {
  test('floor elevation falls back to the plate and commits through the zone intent', () => {
    expect(roomFloorElevation(useScene.getState().nodes, zoneId)).toBeCloseTo(0.05)
    expect(commitRoomElevation(zoneId, 0.45)).toBe(true)
    const zone = useScene.getState().nodes[zoneId as AnyNodeId]
    expect(zone?.type === 'zone' && zone.floor?.elevation).toBe(0.45)
    expect(roomFloorElevation(useScene.getState().nodes, zoneId)).toBe(0.45)
    expect(useScene.temporal.getState().pastStates).toHaveLength(1)
  })

  test('one push arrow per boundary wall span, outside the wall and pointing away from the room', () => {
    const handles = roomPushHandles(useScene.getState().nodes, roomSpans(zoneId))
    expect(handles).toHaveLength(4)
    for (const handle of handles) {
      const fromCenter = [handle.position[0] - 3, handle.position[1] - 2]
      expect(
        fromCenter[0]! * handle.outward[0] + fromCenter[1]! * handle.outward[1],
      ).toBeGreaterThan(0)
      // Outside the room's 6×4 footprint.
      const outside =
        handle.position[0] < 0 ||
        handle.position[0] > 6 ||
        handle.position[1] < 0 ||
        handle.position[1] > 4
      expect(outside).toBe(true)
    }
  })

  test('push previews live and commits the wall with its neighbours in one step', () => {
    const nodes = useScene.getState().nodes
    const east = Object.values(nodes).find(
      (n): n is WallNode => n.type === 'wall' && n.start[0] === 6 && n.end[0] === 6,
    )!
    const handle = roomPushHandles(nodes, roomSpans(zoneId)).find((h) => h.wallId === east.id)!
    expect(handle.outward[0]).toBeCloseTo(1)
    const plan = planRoomPush(nodes, handle, handle.outward, 1)
    expect(plan.conflicts ?? []).toHaveLength(0)
    const updated = plan.changes.filter((c) => c.op === 'update').map((c) => c.id)
    expect(updated).toContain(east.id)
    expect(updated.length).toBeGreaterThan(1)
    expect(previewRoomPush(handle, handle.outward, 1).code).toBeUndefined()
    expect(useLiveNodeOverrides.getState().overrides.get(east.id as AnyNodeId)).toBeDefined()
    expect(useScene.getState().nodes).toBe(nodes)
    endRoomPushPreview()
    expect(useLiveNodeOverrides.getState().overrides.get(east.id as AnyNodeId)).toBeUndefined()
    expect(commitRoomPush(handle, handle.outward, 1)).toBe(true)
    const moved = useScene.getState().nodes[east.id as AnyNodeId] as WallNode
    expect(moved.start[0]).toBeCloseTo(7)
    expect(moved.end[0]).toBeCloseTo(7)
    expect(useScene.temporal.getState().pastStates).toHaveLength(1)
  })

  test('a partial span splits off and moves only the room-facing piece, openings stay put', () => {
    // A 10 m north wall, of which this 6 m room faces only 0..0.6; a door
    // on the far stretch must stay where it is.
    const building = BuildingNode.parse({ id: 'building_partial', children: ['level_partial'] })
    const level = LevelNode.parse({ id: 'level_partial', parentId: building.id })
    useScene.setState({
      nodes: { [building.id]: building, [level.id]: level },
      rootNodeIds: [building.id],
      dirtyNodes: new Set(),
    })
    const walls = [
      [
        [0, 0],
        [6, 0],
      ],
      [
        [6, 0],
        [6, 4],
      ],
      [
        [0, 4],
        [10, 4],
      ],
      [
        [0, 4],
        [0, 0],
      ],
    ].map(([start, end], i) =>
      WallNode.parse({
        id: `wall_partial${i}`,
        parentId: level.id,
        start,
        end,
        thickness: 0.2,
      }),
    )
    useScene
      .getState()
      .applyNodeChanges(structureChangeBatch(walls.map((node) => ({ op: 'create', node }))))
    const door = DoorNode.parse({
      id: 'door_partial',
      parentId: 'wall_partial2',
      wallId: 'wall_partial2',
      position: [8.5, 0, 0],
    })
    useScene.getState().applyNodeChanges({ create: [{ node: door, parentId: 'wall_partial2' }] })
    clearSceneHistory()
    const nodes = useScene.getState().nodes
    const zone = Object.values(nodes).find((n) => n.type === 'zone')!
    const handle = roomPushHandles(nodes, roomSpans(zone.id)).find(
      (h) => h.wallId === 'wall_partial2',
    )!
    expect(handle.t1).toBeCloseTo(0.6)
    expect(commitRoomPush(handle, handle.outward, 1)).toBe(true)
    const after = useScene.getState().nodes
    const north = Object.values(after).filter(
      (n): n is WallNode => n.type === 'wall' && Math.abs(n.start[1] - n.end[1]) < 1e-6,
    )
    // The room's 0..6 stretch moved out to z = 5; the 6..10 stretch stayed at z = 4.
    expect(
      north.some(
        (w) =>
          Math.abs(w.start[1] - 5) < 1e-6 && Math.abs(Math.abs(w.end[0] - w.start[0]) - 6) < 1e-3,
      ),
    ).toBe(true)
    expect(
      north.some(
        (w) =>
          Math.abs(w.start[1] - 4) < 1e-6 && Math.abs(Math.abs(w.end[0] - w.start[0]) - 4) < 1e-3,
      ),
    ).toBe(true)
    const movedDoor = after.door_partial as { parentId: string }
    const host = after[movedDoor.parentId as AnyNodeId] as WallNode
    expect(host.start[1]).toBeCloseTo(4)
    expect(useScene.temporal.getState().pastStates).toHaveLength(1)
  })
})

describe('room gesture ownership', () => {
  function Owner() {
    useGestureLifecycleOwner()
    return null
  }
  test('the owner cancels a pick-up on level change, phase change, scope replacement, room deletion and unmount', async () => {
    await withSelectionHarness(async ({ render }) => {
      await render(createElement(Owner))
      const begin = () => {
        startRoomTransform('move', {
          zoneId,
          levelId: LEVEL,
          outline: [
            [
              [0, 0],
              [6, 0],
              [6, 4],
              [0, 4],
            ],
          ],
          walls: [],
          floorY: 0,
        })
        expect(useRoomTransform.getState().session).not.toBeNull()
        expect(useInteractionScope.getState().scope).toMatchObject({
          kind: 'handle-drag',
          handle: ROOM_MOVE_DRAG_LABEL,
        })
      }
      begin()
      useViewer.getState().setSelection({ levelId: 'level_other' })
      expect(useRoomTransform.getState().session).toBeNull()
      useViewer.getState().setSelection({ levelId: LEVEL })
      begin()
      useEditor.setState({ phase: 'site' })
      expect(useRoomTransform.getState().session).toBeNull()
      useEditor.setState({ phase: 'building' })
      begin()
      useInteractionScope.getState().begin({ kind: 'box-select' })
      expect(useRoomTransform.getState().session).toBeNull()
      // The replacing scope is left alone.
      expect(useInteractionScope.getState().scope.kind).toBe('box-select')
      useInteractionScope.getState().end()
      begin()
      const kept = useScene.getState().nodes
      const nodes = { ...kept }
      delete nodes[zoneId as AnyNodeId]
      useScene.setState({ nodes })
      expect(useRoomTransform.getState().session).toBeNull()
      useScene.setState({ nodes: kept })
      useInteractionScope.getState().end()
      begin()
      await render(null)
      expect(useRoomTransform.getState().session).toBeNull()
    })
  })

  test('a handle drag cleans up once: previews cleared, only its own scope released, commit errors included', async () => {
    const east = Object.values(useScene.getState().nodes).find(
      (n): n is WallNode => n.type === 'wall' && n.start[0] === 6 && n.end[0] === 6,
    )!
    const handle = roomPushHandles(useScene.getState().nodes, roomSpans(zoneId)).find(
      (h) => h.wallId === east.id,
    )!
    let value = 0
    const drag = runRoomHandleDrag({
      label: 'room-push',
      nodeId: east.id,
      zoneId,
      levelId: LEVEL,
      requires: [zoneId, east.id],
      sample: () => 1,
      onValue: (next) => {
        value = next
        previewRoomPush(handle, handle.outward, next)
      },
      onCommit: () => {
        throw Error('boom')
      },
      onCancel: () => endRoomPushPreview(),
    })
    expect(getActiveRoomHandleDrag()).toBe(drag)
    window.dispatchEvent(Object.assign(new Event('pointermove'), { clientX: 1, clientY: 1 }))
    expect(value).toBe(1)
    expect(useLiveNodeOverrides.getState().overrides.get(east.id as AnyNodeId)).toBeDefined()
    expect(() =>
      window.dispatchEvent(Object.assign(new Event('pointerup'), { clientX: 1, clientY: 1 })),
    ).toThrow()
    expect(getActiveRoomHandleDrag()).toBeNull()
    expect(useInteractionScope.getState().scope.kind).toBe('idle')
    endRoomPushPreview()
    // Nothing republishes after cleanup.
    window.dispatchEvent(Object.assign(new Event('pointermove'), { clientX: 2, clientY: 2 }))
    expect(useLiveNodeOverrides.getState().overrides.get(east.id as AnyNodeId)).toBeUndefined()

    // Cancel releases only its own scope.
    runRoomHandleDrag({
      label: 'room-elevation',
      nodeId: zoneId,
      zoneId,
      levelId: LEVEL,
      requires: [zoneId],
      sample: () => 0,
      onValue: () => {},
      onCommit: () => {},
      onCancel: () => {},
    })
    useInteractionScope.getState().begin({ kind: 'box-select' })
    cancelRoomHandleDrag()
    expect(useInteractionScope.getState().scope.kind).toBe('box-select')
    expect(getActiveRoomHandleDrag()).toBeNull()
  })

  test('a release stopped by whatever is under the pointer still ends the drag', () => {
    // A slab hole's hit box stops the native pointerup under an upper floor's
    // height arrows; the drag listens in capture so the release still lands.
    const swallow = (event: Event) => event.stopImmediatePropagation()
    window.addEventListener('pointerup', swallow)
    let committed = 0
    try {
      runRoomHandleDrag({
        label: 'footprint-height',
        nodeId: zoneId,
        zoneId,
        levelId: LEVEL,
        requires: [zoneId],
        sample: () => 0.2,
        onValue: () => {},
        onCommit: () => {
          committed++
        },
        onCancel: () => {},
      })
      window.dispatchEvent(Object.assign(new Event('pointerup'), { clientX: 1, clientY: 1 }))
      expect(committed).toBe(1)
      expect(getActiveRoomHandleDrag()).toBeNull()
      expect(useInteractionScope.getState().scope.kind).toBe('idle')
    } finally {
      window.removeEventListener('pointerup', swallow)
    }
  })

  test('keys typed into a field or owned by another scope never reach a pick-up', () => {
    const room = {
      zoneId,
      levelId: LEVEL,
      outline: [
        [
          [0, 0],
          [6, 0],
          [6, 4],
          [0, 4],
        ],
      ] as [number, number][][],
      walls: [],
      floorY: 0.05,
    }
    expect(startRoomTransform('move', room)).toBe(true)
    const press = (key: string, target?: unknown) => {
      const event = Object.assign(new Event('keydown', { cancelable: true }), { key })
      if (target) Object.defineProperty(event, 'target', { value: target })
      window.dispatchEvent(event)
    }
    const input = { closest: (query: string) => (query.includes('input') ? {} : null) }
    press('r', input)
    press('Escape', input)
    expect(useRoomTransform.getState().session).toMatchObject({ angle: 0 })
    press('r')
    expect(useRoomTransform.getState().session?.angle).toBeCloseTo(Math.PI / 4)
    press('Escape')
    expect(useRoomTransform.getState().session).toBeNull()
    expect(useInteractionScope.getState().scope.kind).toBe('idle')
  })
})

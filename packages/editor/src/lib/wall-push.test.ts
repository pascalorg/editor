import { afterAll, afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test'
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
  nodeRegistry,
  structureChangeBatch,
  useLiveNodeOverrides,
  useScene,
  WallNode,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import useEditor from '../store/use-editor'
import useInteractionScope from '../store/use-interaction-scope'
import { useWallMoveGhosts } from '../store/use-wall-move-ghosts'
import { installImmediateAnimationFrames } from '../test-utils/immediate-animation-frames'
import { cancelGestures } from './gesture-lifecycle'
import {
  getActiveRoomHandleDrag,
  roomPushHandles,
  runFloorplanWallPush,
  runWallPushDrag,
  useRoomHandleDrag,
  WALL_PUSH_DRAG_LABEL,
  type WallPushHandle,
  wallPushHandles,
} from './room-handle-drag'
import type { RoomDimension } from './room-push-dimensions'
import { applyRoomPlan } from './room-structure-commands'

// A selected wall's side arrows and a room's boundary arrows are one drag:
// `runWallPushDrag` → one gesture under the lifecycle owner → one
// `setWallGeometry` commit. The pointer is faked: `along` reads clientX as
// metres travelled along the arrow.

const LEVEL = 'level_wall_push'
const stubbed: string[] = []
let stop = () => {}
let restoreFrames = () => {}
let zoneId = ''
let registry: { mockRestore: () => void } | null = null

const walls = () =>
  Object.values(useScene.getState().nodes).filter((n): n is WallNode => n.type === 'wall')
const wallAtX = (x: number) =>
  walls().find((w) => Math.abs(w.start[0] - x) < 1e-6 && Math.abs(w.end[0] - x) < 1e-6)!

function pointer(type: 'pointermove' | 'pointerup', clientX: number) {
  window.dispatchEvent(Object.assign(new Event(type), { clientX, clientY: 0 }))
}

function press(key: string, metaKey = false) {
  window.dispatchEvent(Object.assign(new Event('keydown', { cancelable: true }), { key, metaKey }))
}

function push(handle: WallPushHandle, zone?: string) {
  return runWallPushDrag({
    handle,
    levelId: LEVEL,
    zoneId: zone,
    from: 0,
    along: (clientX) => clientX,
  })
}

function reset(nodes: WallNode[] = []) {
  const building = BuildingNode.parse({ id: 'building_wall_push', children: [LEVEL] })
  const level = LevelNode.parse({ id: LEVEL, parentId: building.id })
  useScene.setState({
    nodes: { [building.id]: building, [level.id]: level },
    rootNodeIds: [building.id],
    dirtyNodes: new Set(),
    materials: {},
    collections: {},
    readOnly: false,
  })
  if (nodes.length)
    useScene
      .getState()
      .applyNodeChanges(structureChangeBatch(nodes.map((node) => ({ op: 'create', node }))))
}

beforeEach(() => {
  restoreFrames = installImmediateAnimationFrames()
  if (!globalThis.document) {
    globalThis.document = { body: { style: { cursor: '' } } } as unknown as Document
    stubbed.push('document')
  }
  if (!globalThis.window) {
    globalThis.window = new EventTarget() as Window & typeof globalThis
    stubbed.push('window')
  }
  // Walls are 'structural' kinds; the nodes package that registers them is not
  // loaded here, so answer the snap context lookup for them.
  const get = nodeRegistry.get.bind(nodeRegistry)
  registry = spyOn(nodeRegistry, 'get').mockImplementation(((kind: string) =>
    kind === 'wall' ? { snapProfile: 'structural' } : get(kind)) as typeof nodeRegistry.get)
  cancelGestures('cancel')
  useInteractionScope.getState().end()
  useScene.temporal.getState().resume()
  reset()
  stop = initSpaceDetectionSync(useScene, { getState: () => ({ spaces: {}, setSpaces: () => {} }) })
  const plan = createZone(useScene.getState().nodes, {
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
  zoneId = plan.zoneId
  useViewer.getState().setSelection({ levelId: LEVEL, selectedIds: [] })
  useEditor.setState({ phase: 'structure', mode: 'select', gridSnapStep: 0.5 })
  useEditor.getState().setSnappingMode('polygon', 'grid')
  clearSceneHistory()
})

afterEach(() => {
  cancelGestures('cancel')
  stop()
  registry?.mockRestore()
  registry = null
  restoreFrames()
})

afterAll(async () => {
  // Let the click-swallow timers fire before the stubs go.
  await new Promise((resolve) => setTimeout(resolve, 350))
  for (const key of stubbed.splice(0)) delete (globalThis as Record<string, unknown>)[key]
})

describe('a selected wall’s side arrows', () => {
  test('two arrows, one per face, pushing the whole wall outward from it', () => {
    const east = wallAtX(6)
    const handles = wallPushHandles(east, useScene.getState().nodes)
    expect(handles).toHaveLength(2)
    for (const handle of handles) {
      expect(handle).toMatchObject({ wallId: east.id, t0: 0, t1: 1 })
      const side = (handle.position[0] - 6) * handle.outward[0]
      expect(side).toBeGreaterThan(0)
    }
  })

  test('the arrow moves the whole wall, its neighbours follow, one undo step', () => {
    const east = wallAtX(6)
    useViewer.getState().setSelection({ selectedIds: [east.id] })
    const before = useScene.getState().nodes
    const handle = wallPushHandles(east, before).find((h) => h.outward[0] > 0.5)!
    const drag = push(handle)
    expect(getActiveRoomHandleDrag()).toBe(drag!)
    expect(useInteractionScope.getState().scope).toMatchObject({
      kind: 'handle-drag',
      nodeId: east.id,
      handle: WALL_PUSH_DRAG_LABEL,
    })

    // 0.8 m of travel lands the wall on the 0.5 m lattice at x = 7.
    pointer('pointermove', 0.8)
    expect(useRoomHandleDrag.getState().drag).toMatchObject({ kind: 'push', distance: 1 })
    const live = useLiveNodeOverrides.getState().overrides
    expect(live.get(east.id as AnyNodeId)).toMatchObject({ start: [7, expect.any(Number)] })
    // The room's floor follows live, and nothing is written until release.
    expect(live.get(zoneId as AnyNodeId)).toHaveProperty('polygon')
    expect(useScene.getState().nodes).toBe(before)

    pointer('pointerup', 0.8)
    expect(getActiveRoomHandleDrag()).toBeNull()
    expect(useRoomHandleDrag.getState().drag).toBeNull()
    expect(useInteractionScope.getState().scope.kind).toBe('idle')
    expect(useLiveNodeOverrides.getState().overrides.has(east.id)).toBe(false)
    const moved = useScene.getState().nodes[east.id as AnyNodeId] as WallNode
    expect(moved.start[0]).toBeCloseTo(7)
    expect(moved.end[0]).toBeCloseTo(7)
    // Axis lock: the wall keeps its length and direction.
    expect(Math.abs(moved.end[1] - moved.start[1])).toBeCloseTo(4)
    // North and south walls stretch to the new corner instead of leaving a gap.
    const corners = walls()
      .filter((w) => w.id !== east.id)
      .flatMap((w) => [w.start, w.end])
    expect(corners.filter(([x]) => Math.abs(x - 7) < 1e-6)).toHaveLength(2)
    expect(corners.some(([x]) => Math.abs(x - 6) < 1e-6)).toBe(false)
    expect(useViewer.getState().selection.selectedIds).toEqual([east.id])
    expect(useScene.temporal.getState().pastStates).toHaveLength(1)

    useScene.temporal.getState().undo()
    expect((useScene.getState().nodes[east.id as AnyNodeId] as WallNode).start[0]).toBeCloseTo(6)
  })

  test('the drag carries the room’s live width, from the preview, without writing', () => {
    const east = wallAtX(6)
    const before = useScene.getState().nodes
    const handle = wallPushHandles(east, before).find((h) => h.outward[0] > 0.5)!
    push(handle)
    const drag = () => useRoomHandleDrag.getState().drag as { dimensions: RoomDimension[] }
    const [rest] = drag().dimensions
    expect(drag().dimensions).toHaveLength(1)
    expect(rest!.distance).toBeGreaterThan(5)
    expect(rest!.distance).toBeLessThan(6)

    pointer('pointermove', 0.8)
    expect(drag().dimensions).toHaveLength(1)
    expect(drag().dimensions[0]!.distance).toBeCloseTo(rest!.distance + 1)
    expect(useScene.getState().nodes).toBe(before)
    pointer('pointerup', 0.8)
  })

  test('grid snap puts an off-grid wall on the lattice; without grid it moves freely', () => {
    const lone = WallNode.parse({
      id: 'wall_lone',
      parentId: LEVEL,
      start: [0, 10.2],
      end: [4, 10.2],
      thickness: 0.2,
    })
    useScene.getState().applyNodeChanges(structureChangeBatch([{ op: 'create', node: lone }]))
    clearSceneHistory()
    useViewer.getState().setSelection({ selectedIds: [lone.id] })
    const out = (nodes = useScene.getState().nodes) =>
      wallPushHandles(nodes[lone.id as AnyNodeId] as WallNode, nodes).find(
        (h) => h.outward[1] > 0.5,
      )!
    push(out())
    pointer('pointermove', 0.5)
    pointer('pointerup', 0.5)
    const snapped = useScene.getState().nodes[lone.id as AnyNodeId] as WallNode
    expect(snapped.start[1]).toBeCloseTo(10.5)
    expect(snapped.end[1]).toBeCloseTo(10.5)
    expect(snapped.start[0]).toBeCloseTo(0)
    expect(snapped.end[0]).toBeCloseTo(4)

    useEditor.getState().setSnappingMode('polygon', 'off')
    push(out())
    pointer('pointermove', 0.33)
    pointer('pointerup', 0.33)
    expect((useScene.getState().nodes[lone.id as AnyNodeId] as WallNode).start[1]).toBeCloseTo(
      10.83,
    )
  })

  test('a press without travel commits nothing and keeps the wall selected', () => {
    const east = wallAtX(6)
    useViewer.getState().setSelection({ selectedIds: [east.id] })
    const before = useScene.getState().nodes
    push(wallPushHandles(east, before)[0]!)
    pointer('pointerup', 0)
    expect(useScene.getState().nodes).toBe(before)
    expect(useScene.temporal.getState().pastStates).toHaveLength(0)
    expect(useViewer.getState().selection.selectedIds).toEqual([east.id])
  })
})

describe('a room’s boundary arrow', () => {
  test('on a partial span it runs the same drag and splits the wall', () => {
    reset(
      [
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
        WallNode.parse({ id: `wall_span${i}`, parentId: LEVEL, start, end, thickness: 0.2 }),
      ),
    )
    const door = DoorNode.parse({
      id: 'door_span',
      parentId: 'wall_span2',
      wallId: 'wall_span2',
      position: [8.5, 0, 0],
    })
    useScene.getState().applyNodeChanges({ create: [{ node: door, parentId: 'wall_span2' }] })
    clearSceneHistory()
    const nodes = useScene.getState().nodes
    const zone = Object.values(nodes).find((n) => n.type === 'zone')!
    const spans = createZoneDivisionContext(nodes, zone.id).face!.spans
    const handle = roomPushHandles(nodes, spans).find((h) => h.wallId === 'wall_span2')!
    expect(handle.t1).toBeCloseTo(0.6)
    push(handle, zone.id)
    pointer('pointermove', 1)
    // The pieces the push would create show as ghosts while dragging, in 3D
    // (the drag's ghosts) and in the floor plan (its bridge-ghost layer).
    const drag = useRoomHandleDrag.getState().drag
    expect(drag).toMatchObject({ kind: 'push', zoneId: zone.id, distance: 1 })
    expect(drag?.kind === 'push' && drag.ghosts.length).toBeGreaterThan(0)
    expect(useWallMoveGhosts.getState().bridges.length).toBeGreaterThan(0)
    pointer('pointerup', 1)
    expect(useWallMoveGhosts.getState().bridges).toHaveLength(0)
    const north = walls().filter((w) => Math.abs(w.start[1] - w.end[1]) < 1e-6)
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
    const host = useScene.getState().nodes[
      (useScene.getState().nodes.door_span as { parentId: string }).parentId as AnyNodeId
    ] as WallNode
    expect(host.start[1]).toBeCloseTo(4)
    expect(useScene.temporal.getState().pastStates).toHaveLength(1)
  })
})

describe('the floor plan’s wall arrows', () => {
  // Plan coordinates straight from the client point: x → plan x, y → plan z.
  const toPlan = (clientX: number, clientY: number) => [clientX, clientY] as const
  const east = () => wallAtX(6)

  function pointAt(type: 'pointermove' | 'pointerup', x: number, y: number) {
    window.dispatchEvent(Object.assign(new Event(type), { clientX: x, clientY: y }))
  }

  test('an arrow runs the same push: whole wall, neighbours follow, grid lattice, one step', () => {
    const wall = east()
    useViewer.getState().setSelection({ selectedIds: [wall.id] })
    const before = useScene.getState().nodes
    // The east wall runs +z, so its back face ('b') looks out along +x.
    expect(runFloorplanWallPush({ wallId: wall.id, side: 'b' }, 6.4, 2, toPlan)).not.toBeNull()
    expect(useInteractionScope.getState().scope).toMatchObject({
      kind: 'handle-drag',
      nodeId: wall.id,
      handle: WALL_PUSH_DRAG_LABEL,
    })
    // Sideways travel along the wall is ignored (axis lock); 0.8 m out lands on x = 7.
    pointAt('pointermove', 7.2, 3.1)
    const drag = useRoomHandleDrag.getState().drag
    expect(drag).toMatchObject({ kind: 'push', distance: 1 })
    expect(drag?.kind === 'push' && drag.outward[0]).toBeCloseTo(1)
    expect(useScene.getState().nodes).toBe(before)
    pointAt('pointerup', 7.2, 3.1)
    const moved = useScene.getState().nodes[wall.id as AnyNodeId] as WallNode
    expect([moved.start, moved.end]).toEqual([
      [7, 0],
      [7, 4],
    ])
    const corners = walls()
      .filter((w) => w.id !== wall.id)
      .flatMap((w) => [w.start, w.end])
    expect(corners.filter(([x]) => Math.abs(x - 7) < 1e-6)).toHaveLength(2)
    expect(useScene.temporal.getState().pastStates).toHaveLength(1)
    expect(useInteractionScope.getState().scope.kind).toBe('idle')
  })

  test('the front arrow pushes the other way', () => {
    const wall = east()
    useViewer.getState().setSelection({ selectedIds: [wall.id] })
    runFloorplanWallPush({ wallId: wall.id, side: 'a' }, 5.6, 2, toPlan)
    pointAt('pointermove', 4.6, 2)
    pointAt('pointerup', 4.6, 2)
    expect((useScene.getState().nodes[wall.id as AnyNodeId] as WallNode).start[0]).toBeCloseTo(5)
  })

  test('⌘Z mid-drag cancels it through the lifecycle, nothing written', () => {
    const wall = east()
    useViewer.getState().setSelection({ selectedIds: [wall.id] })
    const before = useScene.getState().nodes
    runFloorplanWallPush({ wallId: wall.id, side: 'b' }, 6.4, 2, toPlan)
    pointAt('pointermove', 7.4, 2)
    expect(useLiveNodeOverrides.getState().overrides.has(wall.id)).toBe(true)
    press('z', true)
    expect(getActiveRoomHandleDrag()).toBeNull()
    expect(useLiveNodeOverrides.getState().overrides.has(wall.id)).toBe(false)
    pointAt('pointerup', 7.4, 2)
    expect(useScene.getState().nodes).toBe(before)
    expect(useScene.temporal.getState().pastStates).toHaveLength(0)
  })

  test('a missing wall, a bad payload or no plan under the pointer starts nothing', () => {
    expect(runFloorplanWallPush({ wallId: 'wall_missing', side: 'a' }, 0, 0, toPlan)).toBeNull()
    expect(runFloorplanWallPush(undefined, 0, 0, toPlan)).toBeNull()
    expect(runFloorplanWallPush({ wallId: east().id, side: 'b' }, 0, 0, () => null)).toBeNull()
    expect(getActiveRoomHandleDrag()).toBeNull()
    expect(useInteractionScope.getState().scope.kind).toBe('idle')
  })
})

describe('the push drag under the gesture lifecycle', () => {
  function start() {
    const east = wallAtX(6)
    useViewer.getState().setSelection({ selectedIds: [east.id] })
    const before = useScene.getState().nodes
    push(wallPushHandles(east, before).find((h) => h.outward[0] > 0.5)!)
    pointer('pointermove', 1)
    expect(useLiveNodeOverrides.getState().overrides.has(east.id)).toBe(true)
    return { east, before }
  }
  function expectCancelled(east: WallNode, before: ReturnType<typeof useScene.getState>['nodes']) {
    expect(getActiveRoomHandleDrag()).toBeNull()
    expect(useRoomHandleDrag.getState().drag).toBeNull()
    expect(useLiveNodeOverrides.getState().overrides.has(east.id)).toBe(false)
    expect(useScene.getState().nodes).toBe(before)
    expect(useScene.temporal.getState().pastStates).toHaveLength(0)
    // A late release commits nothing.
    pointer('pointerup', 1)
    expect(useScene.getState().nodes).toBe(before)
  }

  test('losing its scope cancels it and leaves the new scope alone', () => {
    const { east, before } = start()
    useInteractionScope.getState().begin({ kind: 'box-select' })
    expectCancelled(east, before)
    expect(useInteractionScope.getState().scope.kind).toBe('box-select')
  })

  test('⌘Z cancels it without jumping history; Escape too', () => {
    let { east, before } = start()
    press('z', true)
    expectCancelled(east, before)
    expect(useInteractionScope.getState().scope.kind).toBe('idle')
    ;({ east, before } = start())
    press('Escape')
    expectCancelled(east, before)
  })

  test('deselecting the wall or deleting it cancels it', () => {
    let { east, before } = start()
    useViewer.getState().setSelection({ selectedIds: [] })
    expectCancelled(east, before)
    ;({ east, before } = start())
    const nodes = { ...before }
    delete nodes[east.id as AnyNodeId]
    useScene.setState({ nodes })
    expect(getActiveRoomHandleDrag()).toBeNull()
    expect(useLiveNodeOverrides.getState().overrides.has(east.id)).toBe(false)
    useScene.setState({ nodes: before })
  })
})

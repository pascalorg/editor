import { afterAll, afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test'
import {
  type AnyNode,
  type AnyNodeId,
  area,
  BuildingNode,
  clearSceneHistory,
  createZone,
  generateId,
  initSpaceDetectionSync,
  LevelNode,
  nodeRegistry,
  planSeparatorInsertion,
  railingWallDefaults,
  type SeparatorNode,
  structureChangeBatch,
  useLiveNodeOverrides,
  useScene,
  WallNode,
  type ZoneNode,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { getRoomSelectionIndex } from '../hooks/use-selected-room'
import useEditor from '../store/use-editor'
import useInteractionScope from '../store/use-interaction-scope'
import { installImmediateAnimationFrames } from '../test-utils/immediate-animation-frames'
import { cancelGestures } from './gesture-lifecycle'
import { endpointReshapeScope } from './interaction/scope'
import {
  roomPushHandles,
  runFloorplanRoomPush,
  runFloorplanWallPush,
  separatorPushHandles,
  useRoomHandleDrag,
  type WallPushHandle,
} from './room-handle-drag'
import { applyRoomPlan } from './room-structure-commands'
import {
  beginSeparatorEndDrag,
  runSeparatorEndDrag,
  SEPARATOR_END_DRAG_LABEL,
} from './separator-edit'

// A porch off an 8 × 4 house, closed by invisible walls, pushed and dragged
// the way the plan and the 3D view do it. The pointer is faked: plan points
// come straight from the client point (x → plan x, y → plan z).

type Point = [number, number]
const LEVEL = 'level_separator_edit'
const stubbed: string[] = []
let stop = () => {}
let restoreFrames = () => {}
let registry: { mockRestore: () => void } | null = null
const toPlan = (clientX: number, clientY: number): [number, number] => [clientX, clientY]

function pointer(type: 'pointermove' | 'pointerup', x: number, y: number, altKey = false) {
  window.dispatchEvent(Object.assign(new Event(type), { clientX: x, clientY: y, altKey }))
}

const near = (a: Point, b: Point) => Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-6
const separators = () =>
  Object.values(useScene.getState().nodes).filter(
    (node): node is SeparatorNode => node.type === 'separator',
  )
/** The invisible wall from `a` to `b`, either way round. */
const between = (a: Point, b: Point) =>
  separators().find(
    (node) =>
      (near(node.start, a) && near(node.end, b)) || (near(node.start, b) && near(node.end, a)),
  )
const porchZone = () =>
  Object.values(useScene.getState().nodes).find(
    (node): node is ZoneNode =>
      node.type === 'zone' && (node.roomType === 'porch' || node.roomType === 'deck'),
  )
const porchArea = () => {
  const zone = porchZone()
  return zone ? area([{ outer: zone.polygon, holes: zone.holes }]) : 0
}

/** Draws the porch's sides — invisible walls, or railings where `railed` — through the store. */
function drawPorch(
  sides: Array<[Point, Point]> = [
    [
      [2, 4],
      [2, 6],
    ],
    [
      [2, 6],
      [6, 6],
    ],
    [
      [6, 6],
      [6, 4],
    ],
  ],
  railed = false,
) {
  for (const [start, end] of sides) {
    const nodes = useScene.getState().nodes
    if (railed) {
      const railing = WallNode.parse({
        ...railingWallDefaults(),
        id: generateId('wall'),
        parentId: LEVEL,
        start,
        end,
      })
      useScene.getState().applyNodeChanges(structureChangeBatch([{ op: 'create', node: railing }]))
      continue
    }
    const plan = planSeparatorInsertion(nodes as Record<AnyNodeId, AnyNode>, {
      levelId: LEVEL as AnyNodeId,
      start,
      end,
      joinRadius: 0.05,
      mintId: () => generateId('separator'),
    })
    useScene.getState().applyNodeChanges(plan!.changes)
  }
  clearSceneHistory()
}

function porchHandles(): WallPushHandle[] {
  const zone = porchZone()!
  const record = getRoomSelectionIndex(LEVEL)
    .update(useScene.getState().nodes)
    .find((room) => room.zoneId === zone.id)!
  return roomPushHandles(useScene.getState().nodes, record.spans)
}

/** The porch arrow pointing along `direction`. */
const arrow = (handles: WallPushHandle[], direction: Point) =>
  handles.find(
    (handle) =>
      handle.outward[0] * direction[0] + handle.outward[1] * direction[1] > 0.99 &&
      !!handle.separators,
  )

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
  // The nodes package that registers walls and invisible walls is not loaded
  // here: answer their snap context lookup as their definitions do.
  const get = nodeRegistry.get.bind(nodeRegistry)
  registry = spyOn(nodeRegistry, 'get').mockImplementation(((kind: string) =>
    kind === 'wall' || kind === 'separator'
      ? { snapProfile: 'structural' }
      : get(kind)) as typeof nodeRegistry.get)
  cancelGestures('cancel')
  useInteractionScope.getState().end()
  const building = BuildingNode.parse({ id: 'building_separator_edit', children: [LEVEL] })
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
  applyRoomPlan(
    createZone(useScene.getState().nodes, {
      levelId: LEVEL,
      polygon: [
        [0, 0],
        [8, 0],
        [8, 4],
        [0, 4],
      ],
      enclose: true,
      mintId: generateId,
    }),
  )
  useViewer.getState().setSelection({ buildingId: building.id, levelId: LEVEL, selectedIds: [] })
  useEditor.setState({ phase: 'building', mode: 'select', gridSnapStep: 0.5 })
  useEditor.getState().setSnappingMode('polygon', 'grid')
  useEditor.getState().setSnappingMode('wall', 'grid')
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

describe('a porch closed by invisible walls, selected', () => {
  test('has a push arrow on each invisible-wall edge, pointing off the porch, beside the house wall’s', () => {
    drawPorch()
    expect(porchZone()?.roomType).toBe('porch')
    const handles = porchHandles()
    for (const direction of [
      [-1, 0],
      [0, 1],
      [1, 0],
    ] as Point[])
      expect(arrow(handles, direction)?.separators).toHaveLength(1)
    // The house wall's arrow is the wall push it always was.
    expect(handles.filter((handle) => !handle.separators)).toHaveLength(1)
    const bottom = arrow(handles, [0, 1])!
    expect(bottom.position[0]).toBeCloseTo(4, 6)
    expect(bottom.position[1]).toBeGreaterThan(6)
  })

  test('an edge drawn in two pieces has one arrow, and it pushes both', () => {
    drawPorch([
      [
        [2, 4],
        [2, 6],
      ],
      [
        [2, 6],
        [4, 6],
      ],
      [
        [4, 6],
        [6, 6],
      ],
      [
        [6, 6],
        [6, 4],
      ],
    ])
    const bottom = arrow(porchHandles(), [0, 1])!
    expect(bottom.separators).toHaveLength(2)
    expect(bottom.position[0]).toBeCloseTo(4, 6)
    runFloorplanRoomPush({ handle: bottom, levelId: LEVEL, clientX: 4, clientY: 6.3, toPlan })
    pointer('pointermove', 4, 7.3)
    pointer('pointerup', 4, 7.3)
    expect(between([2, 7], [4, 7])).toBeDefined()
    expect(between([4, 7], [6, 7])).toBeDefined()
    expect(porchArea()).toBeCloseTo(12, 6)
  })

  test('its edge pushed out moves the invisible wall, the sides follow, the porch grows; one undo step', () => {
    drawPorch()
    const before = useScene.getState().nodes
    const bottom = arrow(porchHandles(), [0, 1])!
    const zoneId = porchZone()!.id
    expect(
      runFloorplanRoomPush({
        handle: bottom,
        levelId: LEVEL,
        zoneId,
        clientX: 4,
        clientY: 6.3,
        toPlan,
      }),
    ).not.toBeNull()
    const depth = () => {
      const drag = useRoomHandleDrag.getState().drag
      return drag?.kind === 'push' ? drag.dimensions.map((dimension) => dimension.distance) : []
    }
    // The porch's depth, edge to the house wall's outside face.
    const [rest] = depth()
    expect(rest).toBeGreaterThan(1.8)
    expect(rest).toBeLessThan(2)
    // 0.8 m of travel lands the edge on the 0.5 m lattice, a metre out.
    pointer('pointermove', 4, 7.1)
    expect(useRoomHandleDrag.getState().drag).toMatchObject({ kind: 'push', distance: 1 })
    expect(depth()[0]).toBeCloseTo(rest! + 1, 6)
    const live = useLiveNodeOverrides.getState().overrides
    const preview = live.get(bottom.wallId) as Partial<SeparatorNode> | undefined
    expect(preview?.start?.[1]).toBeCloseTo(7, 6)
    // The porch floor follows live; nothing is written until release.
    expect(live.get(zoneId as AnyNodeId)).toHaveProperty('polygon')
    expect(useScene.getState().nodes).toBe(before)

    pointer('pointerup', 4, 7.1)
    expect(useLiveNodeOverrides.getState().overrides.has(bottom.wallId)).toBe(false)
    expect(between([2, 7], [6, 7])?.id).toBe(bottom.wallId as SeparatorNode['id'])
    expect(between([2, 4], [2, 7])).toBeDefined()
    expect(between([6, 7], [6, 4])).toBeDefined()
    expect(porchArea()).toBeCloseTo(12, 6)
    expect(useScene.temporal.getState().pastStates).toHaveLength(1)

    useScene.temporal.getState().undo()
    expect(between([2, 6], [6, 6])).toBeDefined()
    expect(between([2, 4], [2, 6])).toBeDefined()
    expect(porchArea()).toBeCloseTo(8, 6)
  })

  test('pulled in, it shrinks the porch and stays closed', () => {
    drawPorch()
    const bottom = arrow(porchHandles(), [0, 1])!
    runFloorplanRoomPush({ handle: bottom, levelId: LEVEL, clientX: 4, clientY: 6.3, toPlan })
    pointer('pointermove', 4, 5.3)
    pointer('pointerup', 4, 5.3)
    expect(between([2, 5], [6, 5])).toBeDefined()
    expect(porchArea()).toBeCloseTo(4, 6)
  })

  test('its house-wall arrow still pushes the house wall, the porch following it', () => {
    drawPorch()
    const house = porchHandles().find((handle) => !handle.separators)!
    expect(house.outward[1]).toBeCloseTo(-1, 6)
    runFloorplanRoomPush({
      handle: house,
      levelId: LEVEL,
      clientX: house.position[0],
      clientY: house.position[1],
      toPlan,
    })
    pointer('pointermove', house.position[0], house.position[1] - 1)
    pointer('pointerup', house.position[0], house.position[1] - 1)
    const moved = Object.values(useScene.getState().nodes).find(
      (node): node is WallNode =>
        node.type === 'wall' &&
        Math.abs(node.start[1] - 3) < 1e-6 &&
        Math.abs(node.end[1] - 3) < 1e-6,
    )
    expect(moved).toBeDefined()
    expect(porchArea()).toBeCloseTo(12, 6)
  })
})

test('a deck fenced by railings has the wall arrows on its railings', () => {
  drawPorch(undefined, true)
  const deck = porchZone()
  expect(deck?.roomType).toBe('deck')
  const record = getRoomSelectionIndex(LEVEL)
    .update(useScene.getState().nodes)
    .find((room) => room.zoneId === deck!.id)!
  const handles = roomPushHandles(useScene.getState().nodes, record.spans)
  const railings = handles.filter(
    (handle) =>
      (useScene.getState().nodes[handle.wallId as AnyNodeId] as WallNode).wallType === 'railing',
  )
  expect(railings).toHaveLength(3)
  expect(railings.every((handle) => !handle.separators)).toBe(true)
})

describe('a selected invisible wall', () => {
  test('its side arrow pushes it, the invisible wall joined to it stretching and its end sliding on the house', () => {
    drawPorch()
    const left = between([2, 4], [2, 6])!
    useViewer.getState().setSelection({ selectedIds: [left.id] })
    const side = separatorPushHandles(left).find((handle) => handle.outward[0] < -0.99)!
    expect(
      runFloorplanWallPush(
        { wallId: left.id, side: side.key.endsWith(':a') ? 'a' : 'b' },
        1.9,
        5,
        toPlan,
      ),
    ).not.toBeNull()
    pointer('pointermove', 0.9, 5)
    pointer('pointerup', 0.9, 5)
    expect(between([1, 4], [1, 6])?.id).toBe(left.id)
    expect(between([1, 6], [6, 6])).toBeDefined()
    expect(porchArea()).toBeCloseTo(10, 6)
    expect(useScene.temporal.getState().pastStates).toHaveLength(1)
  })

  /** Drags the end of `separator` at `corner` (its 3D grip) along `path`, Alt held when `alt`. */
  function dragEnd(separator: SeparatorNode, corner: Point, path: Point[], alt = false) {
    const endpoint = near(separator.start, corner) ? 'start' : 'end'
    runSeparatorEndDrag({ separatorId: separator.id, endpoint, levelId: LEVEL, toPlan })
    for (const [x, z] of path) pointer('pointermove', x, z, alt)
    const [x, z] = path.at(-1)!
    pointer('pointerup', x, z, alt)
  }

  test('an end dragged takes the invisible wall joined there along, square and on the grid', () => {
    drawPorch()
    const bottom = between([2, 6], [6, 6])!
    const endpoint = near(bottom.start, [2, 6]) ? 'start' : 'end'
    runSeparatorEndDrag({ separatorId: bottom.id, endpoint, levelId: LEVEL, toPlan })
    expect(useInteractionScope.getState().scope).toMatchObject({
      kind: 'handle-drag',
      nodeId: bottom.id,
      handle: SEPARATOR_END_DRAG_LABEL,
    })
    pointer('pointermove', 1.07, 5.96)
    const live = useLiveNodeOverrides.getState().overrides.get(bottom.id) as Partial<SeparatorNode>
    expect(live[endpoint]).toEqual([1, 6])
    expect(between([2, 6], [6, 6])).toBeDefined()
    pointer('pointerup', 1.07, 5.96)
    expect(between([1, 6], [6, 6])?.id).toBe(bottom.id)
    expect(between([2, 4], [1, 6])).toBeDefined()
    expect(useLiveNodeOverrides.getState().overrides.has(bottom.id)).toBe(false)
    expect(useScene.temporal.getState().pastStates).toHaveLength(1)
    expect(useInteractionScope.getState().scope.kind).toBe('idle')
  })

  test('let go with Alt, its end comes back together on its old corner', () => {
    drawPorch()
    const bottom = between([2, 6], [6, 6])!
    dragEnd(bottom, [2, 6], [[1, 7]], true)
    expect(between([2, 4], [2, 6])).toBeDefined()
    expect(between([2, 6], [6, 6])).toBeUndefined()

    const moved = useScene.getState().nodes[bottom.id as AnyNodeId] as SeparatorNode
    dragEnd(moved, near(moved.start, [6, 6]) ? moved.end : moved.start, [[2.12, 6.09]], true)
    expect(between([2, 6], [6, 6])?.id).toBe(bottom.id)
    expect(porchArea()).toBeCloseTo(8, 6)
  })

  test('the plan’s end handle runs the same drag', () => {
    drawPorch()
    const bottom = between([2, 6], [6, 6])!
    const endpoint = near(bottom.start, [2, 6]) ? 'start' : 'end'
    // The plan begins its end-drag scope (the wall snapping set) around the session.
    useInteractionScope.getState().begin(endpointReshapeScope(bottom.id, endpoint, 'floorplan'))
    const session = beginSeparatorEndDrag(bottom.id, endpoint)!
    session.move([1.07, 6.04], false)
    expect(session.canCommit()).toBe(true)
    useInteractionScope.getState().end()
    expect(session.commit()).toBe(true)
    expect(between([1, 6], [6, 6])?.id).toBe(bottom.id)
    expect(between([2, 4], [1, 6])).toBeDefined()
  })
})

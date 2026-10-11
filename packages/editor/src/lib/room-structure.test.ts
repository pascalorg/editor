import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  type AnyNodeId,
  BuildingNode,
  clearSceneHistory,
  createZone,
  DoorNode,
  divideZone,
  generateId,
  ItemNode,
  initSpaceDetectionSync,
  LevelNode,
  SHARED_WALLS_DELETE_MESSAGE,
  structureChangeBatch,
  useScene,
  WallNode,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { deleteConfirmationContent } from '../components/editor/delete-confirmation-dialog'
import { deleteSelection } from '../components/editor/group-actions'
import { NodeActionMenu } from '../components/editor/node-action-menu'
import {
  bindDividePointer,
  divideEndOutside,
  divideFloorPoint,
  isDivideTypingTarget,
  resolveRoomDividePlanPoint,
  roomDeleteBlockedReason,
  useDivideLifetime,
} from '../components/editor/room-controls'
import { runHistoryShortcut } from '../hooks/use-keyboard'
import useDeleteConfirmation from '../store/use-delete-confirmation'
import useEditor from '../store/use-editor'
import useInteractionScope from '../store/use-interaction-scope'
import useWallSnapIndicator from '../store/use-wall-snap-indicator'
import { installImmediateAnimationFrames } from '../test-utils/immediate-animation-frames'
import { withSelectionHarness } from '../test-utils/selection-harness'
import { resolveOverlayPolicy } from './interaction/overlay-policy'
import {
  cancelRoomDivide,
  clickRoomDivide,
  finishRoomDivide,
  previewRoomDivide,
  removeLastRoomDividePoint,
  roomDivideContext,
  startRoomDivide,
} from './room-divide-session'
import { roomNameSections } from './room-name-catalog'
import {
  applyRoomPlan,
  renameRoom,
  requestRoomDeletion,
  separatorMergePlan,
} from './room-structure-commands'
import { useRoomTransform } from './room-transform-session'
import { sfxEmitter } from './sfx-bus'

let zoneId: string
let stop = () => {}
let restoreFrames = () => {}
beforeEach(() => {
  restoreFrames = installImmediateAnimationFrames()
  useInteractionScope.getState().end()
  const building = BuildingNode.parse({
    id: 'building_room_controls',
    children: ['level_room_controls'],
  })
  const level = LevelNode.parse({ id: 'level_room_controls', parentId: building.id })
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
  const plan = createZone(useScene.getState().nodes, {
    levelId: level.id,
    polygon: [
      [0, 0],
      [8, 0],
      [8, 4],
      [0, 4],
    ],
    enclose: true,
    mintId: generateId,
  })
  applyRoomPlan(plan)
  zoneId = plan.zoneId
  useViewer.getState().setSelection({ buildingId: building.id, levelId: level.id, selectedIds: [] })
  useEditor.setState({
    phase: 'building',
    mode: 'select',
    room: { zoneId, levelId: level.id },
    gridSnapStep: 0.5,
    snappingModeByContext: { wall: 'grid', item: 'lines', polygon: 'grid', rotation: 'angles' },
  })
  clearSceneHistory()
})
afterEach(() => {
  stop()
  cancelRoomDivide()
  useDeleteConfirmation.getState().cancel()
  restoreFrames()
})

describe('room structure controls', () => {
  test('Divide start/preview/click-click commit is transient until the second click', () => {
    const before = useScene.getState().nodes
    startRoomDivide(zoneId, 'level_room_controls')
    previewRoomDivide([2.2, 0.1])
    expect(useInteractionScope.getState().scope).toMatchObject({
      kind: 'room-divide',
      points: [],
      end: [2, 0],
      endKind: 'start',
    })
    expect(clickRoomDivide()).toBe(false)
    previewRoomDivide([2.2, 3.9])
    expect(useScene.getState().nodes).toBe(before)
    expect(useScene.temporal.getState().pastStates).toHaveLength(0)
    expect(clickRoomDivide()).toBe(true)
    expect(useInteractionScope.getState().scope).toEqual({ kind: 'idle' })
    expect(Object.values(useScene.getState().nodes).filter((n) => n.type === 'zone')).toHaveLength(
      2,
    )
    expect(useScene.temporal.getState().pastStates).toHaveLength(1)
  })
  test('Divide sounds and snaps like a wall draft: start, ticks, beacons, built', () => {
    const sounds: string[] = []
    const listeners = {
      'sfx:structure-build-start': () => sounds.push('start'),
      'sfx:grid-snap': () => sounds.push('tick'),
      'sfx:structure-build': () => sounds.push('build'),
    } as const
    for (const [event, listener] of Object.entries(listeners))
      sfxEmitter.on(event as keyof typeof listeners, listener)
    try {
      const snap = () => useWallSnapIndicator.getState().point
      startRoomDivide(zoneId, 'level_room_controls')
      // On the boundary: the beacon marks the wall the cut starts on.
      previewRoomDivide([2.2, 0.1])
      expect(snap()).toMatchObject({ x: 2, z: 0, kind: 'wall' })
      clickRoomDivide()
      expect(sounds).toEqual(['start'])
      // A free point inside the room: no beacon; each new snapped spot ticks.
      previewRoomDivide([2.1, 2.1])
      expect(snap()).toBeNull()
      previewRoomDivide([2.1, 2.1])
      previewRoomDivide([3, 2])
      expect(sounds).toEqual(['start', 'tick', 'tick'])
      // Back on the boundary to finish: the beacon again, then the build cue.
      previewRoomDivide([3, 3.9])
      expect(snap()).toMatchObject({ x: 3, z: 4, kind: 'wall' })
      expect(clickRoomDivide()).toBe(true)
      expect(sounds).toEqual(['start', 'tick', 'tick', 'tick', 'build'])
      expect(snap()).toBeNull()
    } finally {
      for (const [event, listener] of Object.entries(listeners))
        sfxEmitter.off(event as keyof typeof listeners, listener)
    }
  })
  test('an island closing on its first point shows the corner beacon there', () => {
    startRoomDivide(zoneId, 'level_room_controls')
    for (const point of [
      [2, 1],
      [5, 1],
      [5, 3],
      [2, 3],
    ] as const) {
      previewRoomDivide([point[0], point[1]])
      clickRoomDivide()
    }
    previewRoomDivide([2.1, 1.1])
    expect(useWallSnapIndicator.getState().point).toMatchObject({ x: 2, z: 1, kind: 'endpoint' })
    cancelRoomDivide()
    expect(useWallSnapIndicator.getState().point).toBeNull()
  })
  test('a pointer resolved on a wall surface cuts to that wall, past the free-pointer cap', () => {
    const nodes = useScene.getState().nodes
    const walls = Object.values(nodes).filter((node) => node.type === 'wall')
    const near = walls.find((wall) => wall.start[1] === 0 && wall.end[1] === 0)!
    const far = walls.find((wall) => wall.start[1] === 4 && wall.end[1] === 4)!
    startRoomDivide(zoneId, 'level_room_controls')
    // What the floor plane returns for a pointer aimed at a wall in 3D: the ray
    // carries past the wall and lands metres outside the room.
    previewRoomDivide([2, -2.3])
    expect(useInteractionScope.getState().scope).toMatchObject({ valid: false, end: [2, -2.3] })
    previewRoomDivide([2, -2.3], near.id)
    expect(useInteractionScope.getState().scope).toMatchObject({ end: [2, 0], valid: true })
    expect(clickRoomDivide()).toBe(false)
    previewRoomDivide([2.1, 6.4], far.id)
    expect(useInteractionScope.getState().scope).toMatchObject({
      points: [[2, 0]],
      end: [2, 4],
      endKind: 'edge',
      valid: true,
    })
    expect(clickRoomDivide()).toBe(true)
    expect(Object.values(useScene.getState().nodes).filter((n) => n.type === 'zone')).toHaveLength(
      2,
    )
    expect(useScene.temporal.getState().pastStates).toHaveLength(1)
  })
  test('Divide snaps through the wall tool snapping modes', () => {
    const snapTo = (wall: 'grid' | 'lines' | 'angles' | 'off') =>
      useEditor.setState({
        snappingModeByContext: { wall, item: 'lines', polygon: 'grid', rotation: 'angles' },
      })
    startRoomDivide(zoneId, 'level_room_controls')
    previewRoomDivide([2, 0])
    clickRoomDivide()
    // Lines squares the cut to the edge it starts from, within 15 cm.
    snapTo('lines')
    previewRoomDivide([2.12, 4])
    expect(useInteractionScope.getState().scope).toMatchObject({ end: [2, 4], valid: true })
    previewRoomDivide([2.2, 4])
    expect(useInteractionScope.getState().scope).toMatchObject({ end: [2.2, 4], valid: true })
    // Off keeps the free boundary station.
    snapTo('off')
    previewRoomDivide([2.12, 4])
    expect(useInteractionScope.getState().scope).toMatchObject({ end: [2.12, 4], valid: true })
    // Grid steps along the edge.
    snapTo('grid')
    previewRoomDivide([2.12, 4])
    expect(useInteractionScope.getState().scope).toMatchObject({ end: [2, 4], valid: true })
    // Angles locks the cut to 15° rays: 46° from the start reads as 45°.
    snapTo('angles')
    const t = Math.tan((46 * Math.PI) / 180)
    previewRoomDivide([2 + 4 / t, 4])
    const scope = useInteractionScope.getState().scope
    if (scope.kind !== 'room-divide' || !scope.end) throw Error('expected a divide preview')
    expect(scope.end[0]).toBeCloseTo(6)
    expect(scope.end[1]).toBeCloseTo(4)
  })
  test('invalid previews carry a short cursor label', () => {
    startRoomDivide(zoneId, 'level_room_controls')
    previewRoomDivide([4, 7])
    expect(useInteractionScope.getState().scope).toMatchObject({
      valid: false,
      message: 'Move to an edge',
    })
    previewRoomDivide([2, 0])
    clickRoomDivide()
    previewRoomDivide([2, 0.02])
    expect(useInteractionScope.getState().scope).toMatchObject({ valid: false })
    const scope = useInteractionScope.getState().scope
    const message = scope.kind === 'room-divide' ? scope.message : undefined
    expect(message).toBeTruthy()
    expect(message!.length).toBeLessThan(20)
  })
  test('a path adds free points inside the room and finishes on the boundary', () => {
    startRoomDivide(zoneId, 'level_room_controls')
    previewRoomDivide([2, 0.2])
    clickRoomDivide()
    // Away from the boundary the point is free (grid-snapped), not an edge.
    previewRoomDivide([3.1, 1.9])
    expect(useInteractionScope.getState().scope).toMatchObject({
      end: [3, 2],
      endKind: 'point',
      valid: true,
    })
    expect(clickRoomDivide()).toBe(false)
    previewRoomDivide([5, 1.2])
    clickRoomDivide()
    expect(useInteractionScope.getState().scope).toMatchObject({
      points: [
        [2, 0],
        [3, 2],
        [5, 1],
      ],
    })
    // Crossing an earlier segment is refused where the pointer is.
    previewRoomDivide([2, 1.5])
    expect(useInteractionScope.getState().scope).toMatchObject({
      endKind: 'point',
      valid: false,
      message: 'Crosses itself',
    })
    // Back on the boundary the live point finishes the cut.
    previewRoomDivide([5.1, 3.8])
    expect(useInteractionScope.getState().scope).toMatchObject({ end: [5, 4], endKind: 'edge' })
    // Backspace drops the last point and re-reads the pointer.
    expect(removeLastRoomDividePoint()).toBe(true)
    expect(useInteractionScope.getState().scope).toMatchObject({
      points: [
        [2, 0],
        [3, 2],
      ],
      end: [5, 4],
      endKind: 'edge',
    })
    expect(useScene.temporal.getState().pastStates).toHaveLength(0)
  })
  test('an open path commits in one step with a separator per segment', () => {
    startRoomDivide(zoneId, 'level_room_controls')
    for (const point of [
      [2, 0.2],
      [3, 2],
    ] as const) {
      previewRoomDivide([point[0], point[1]])
      clickRoomDivide()
    }
    previewRoomDivide([5.1, 3.8])
    expect(useInteractionScope.getState().scope).toMatchObject({
      end: [5, 4],
      endKind: 'edge',
      valid: true,
    })
    expect(finishRoomDivide()).toBe(true)
    const nodes = Object.values(useScene.getState().nodes)
    expect(nodes.filter((n) => n.type === 'zone')).toHaveLength(2)
    expect(nodes.filter((n) => n.type === 'separator')).toHaveLength(2)
    expect(useScene.temporal.getState().pastStates).toHaveLength(1)
  })
  test('Enter finishes a straight cut on the boundary; nothing else', () => {
    startRoomDivide(zoneId, 'level_room_controls')
    previewRoomDivide([2, 0.2])
    expect(finishRoomDivide()).toBe(false)
    clickRoomDivide()
    previewRoomDivide([3, 2])
    expect(finishRoomDivide()).toBe(false)
    previewRoomDivide([2.1, 3.9])
    expect(finishRoomDivide()).toBe(true)
    expect(Object.values(useScene.getState().nodes).filter((n) => n.type === 'zone')).toHaveLength(
      2,
    )
  })
  test('an island starts inside the room and closes on its first point', () => {
    startRoomDivide(zoneId, 'level_room_controls')
    previewRoomDivide([2, 1.1])
    expect(useInteractionScope.getState().scope).toMatchObject({
      end: [2, 1],
      endKind: 'start',
      valid: true,
    })
    clickRoomDivide()
    expect(useInteractionScope.getState().scope).toMatchObject({ startBoundaryId: undefined })
    // An island cannot finish on the boundary.
    previewRoomDivide([2, 0.1])
    expect(useInteractionScope.getState().scope).toMatchObject({
      valid: false,
      message: 'Close the loop',
    })
    for (const point of [
      [5, 1],
      [5, 3],
      [2, 3],
    ] as const) {
      previewRoomDivide([point[0], point[1]])
      clickRoomDivide()
    }
    previewRoomDivide([2.1, 1.15])
    expect(useInteractionScope.getState().scope).toMatchObject({ end: [2, 1], endKind: 'close' })
    // Past the close radius, a grid step that lands on the first point closes too.
    previewRoomDivide([2.2, 1.24])
    expect(useInteractionScope.getState().scope).toMatchObject({ end: [2, 1], endKind: 'close' })
    expect(useInteractionScope.getState().scope).toMatchObject({ valid: true })
    expect(clickRoomDivide()).toBe(true)
    const zones = Object.values(useScene.getState().nodes).filter((n) => n.type === 'zone')
    expect(zones).toHaveLength(2)
    expect(
      Object.values(useScene.getState().nodes).filter((n) => n.type === 'separator'),
    ).toHaveLength(4)
    expect(useScene.temporal.getState().pastStates).toHaveLength(1)
  })
  test('Divide cancel clears the scope without history or scene writes', () => {
    const before = useScene.getState().nodes
    startRoomDivide(zoneId, 'level_room_controls')
    previewRoomDivide([2, 0])
    clickRoomDivide()
    previewRoomDivide([3, 4])
    cancelRoomDivide()
    expect(useInteractionScope.getState().scope).toEqual({ kind: 'idle' })
    expect(useScene.getState().nodes).toBe(before)
    expect(useScene.temporal.getState().pastStates).toHaveLength(0)
  })
  test('delete confirmation previews IDs and waits before applying', () => {
    const wall = Object.values(useScene.getState().nodes).find((n) => n.type === 'wall')!
    const door = DoorNode.parse({
      id: 'door_confirmation',
      parentId: wall.id,
      wallId: wall.id,
      position: [2, 0, 0],
    })
    const item = ItemNode.parse({
      id: 'item_confirmation',
      parentId: 'level_room_controls',
      position: [2, 0, 2],
      asset: {
        id: 'chair',
        category: 'chairs',
        name: 'Chair',
        thumbnail: '',
        src: 'https://example.com/chair.glb',
      },
    })
    useScene.getState().applyNodeChanges({
      create: [
        { node: door, parentId: wall.id },
        { node: item, parentId: 'level_room_controls' },
      ],
    })
    clearSceneHistory()
    requestRoomDeletion(zoneId)
    const request = useDeleteConfirmation.getState().request!
    expect(request.room).toMatchObject({
      zoneId,
      contents: 'delete',
      keptSharedWallIds: [],
      openingIds: [door.id],
      itemIds: [item.id],
    })
    expect(request.room!.wallIds).toHaveLength(4)
    expect(useScene.getState().nodes[zoneId as AnyNodeId]).toBeDefined()
    useDeleteConfirmation.getState().confirm()
    expect(useScene.getState().nodes[zoneId as AnyNodeId]).toBeUndefined()
    expect(useScene.temporal.getState().pastStates).toHaveLength(1)
  })
  test('separator Delete merges through the primitive in one history step', () => {
    const plan = divideZone(useScene.getState().nodes, {
      zoneId,
      cut: [
        [2, 0],
        [2, 4],
      ],
      mintId: generateId,
    })
    useScene.getState().applyNodeChanges(structureChangeBatch(plan.changes))
    clearSceneHistory()
    const id = plan.separatorId as AnyNodeId
    expect(separatorMergePlan(useScene.getState().nodes, id).changes).toEqual([
      { op: 'delete', id },
    ])
    useViewer.getState().setSelection({ selectedIds: [id] })
    expect(deleteSelection()).toBe(true)
    expect(Object.values(useScene.getState().nodes).filter((n) => n.type === 'zone')).toHaveLength(
      1,
    )
    expect(useScene.temporal.getState().pastStates).toHaveLength(1)
  })
  test('combobox accepts verbatim custom names and never lists other rooms’ names', () => {
    expect(renameRoom(zoneId, '  Garden studio  ')).toBe(true)
    expect(useScene.getState().nodes[zoneId as AnyNodeId]?.name).toBe('  Garden studio  ')
    const nodes = useScene.getState().nodes
    const offered = roomNameSections(nodes, 'zone_other').flatMap((s) => s.names)
    expect(offered).not.toContain('Garden studio')
    expect(useScene.temporal.getState().pastStates).toHaveLength(1)
  })
  test('Backspace drops a point; Escape releases the scope and overlays without writing the scene', () => {
    const surface = new EventTarget(),
      keyboard = new EventTarget()
    const dispose = bindDividePointer(surface, () => ({ point: [2, 0] }), keyboard)
    const before = useScene.getState().nodes
    try {
      startRoomDivide(zoneId, 'level_room_controls')
      previewRoomDivide([2, 0])
      clickRoomDivide()
      previewRoomDivide([3, 2])
      clickRoomDivide()
      keyboard.dispatchEvent(Object.assign(new Event('keydown'), { key: 'Backspace' }))
      expect(useInteractionScope.getState().scope).toMatchObject({ points: [[2, 0]] })
      keyboard.dispatchEvent(Object.assign(new Event('keydown'), { key: 'Escape' }))
      expect(useInteractionScope.getState().scope.kind).toBe('idle')
      expect(resolveOverlayPolicy(useInteractionScope.getState().scope).conflictingControls).toBe(
        'shown',
      )
      expect(useScene.getState().nodes).toBe(before)
    } finally {
      dispose()
    }
  })
  test('split view: two bound surfaces act on one Backspace once', () => {
    const keyboard = new EventTarget()
    const plan = bindDividePointer(new EventTarget(), () => null, keyboard)
    const scene = bindDividePointer(new EventTarget(), () => null, keyboard)
    const backspace = () =>
      keyboard.dispatchEvent(Object.assign(new Event('keydown'), { key: 'Backspace' }))
    try {
      startRoomDivide(zoneId, 'level_room_controls')
      for (const point of [
        [2, 0.2],
        [3, 2],
        [5, 1],
      ] as const) {
        previewRoomDivide([point[0], point[1]])
        clickRoomDivide()
      }
      backspace()
      expect(useInteractionScope.getState().scope).toMatchObject({
        points: [
          [2, 0],
          [3, 2],
        ],
      })
      scene()
      backspace()
      expect(useInteractionScope.getState().scope).toMatchObject({ points: [[2, 0]] })
    } finally {
      plan()
      scene()
    }
    backspace()
    expect(useInteractionScope.getState().scope).toMatchObject({ points: [[2, 0]] })
  })
  test('keys typed into a field never reach the Divide draft', () => {
    const field = (selector: string) => ({
      closest: (query: string) => (query.split(', ').includes(selector) ? {} : null),
    })
    expect(isDivideTypingTarget(field('input') as unknown as EventTarget)).toBe(true)
    expect(isDivideTypingTarget(field('[role="combobox"]') as unknown as EventTarget)).toBe(true)
    expect(isDivideTypingTarget(field('[role="dialog"]') as unknown as EventTarget)).toBe(true)
    expect(isDivideTypingTarget({ isContentEditable: true } as unknown as EventTarget)).toBe(true)
    expect(isDivideTypingTarget({ closest: () => null } as unknown as EventTarget)).toBe(false)
    expect(isDivideTypingTarget(null)).toBe(false)

    const keyboard = new EventTarget()
    const dispose = bindDividePointer(new EventTarget(), () => null, keyboard)
    const press = (key: string, target?: unknown) => {
      const event = Object.assign(new Event('keydown', { cancelable: true }), { key })
      if (target) Object.defineProperty(event, 'target', { value: target })
      keyboard.dispatchEvent(event)
    }
    try {
      startRoomDivide(zoneId, 'level_room_controls')
      previewRoomDivide([2, 0.2])
      clickRoomDivide()
      previewRoomDivide([3, 2])
      clickRoomDivide()
      for (const key of ['Backspace', 'Enter', 'Escape']) press(key, field('input'))
      expect(useInteractionScope.getState().scope).toMatchObject({
        kind: 'room-divide',
        points: [
          [2, 0],
          [3, 2],
        ],
      })
      // Another handler that already took the key keeps it.
      const taken = Object.assign(new Event('keydown', { cancelable: true }), { key: 'Backspace' })
      taken.preventDefault()
      keyboard.dispatchEvent(taken)
      expect(useInteractionScope.getState().scope).toMatchObject({
        points: [
          [2, 0],
          [3, 2],
        ],
      })
      press('Backspace')
      expect(useInteractionScope.getState().scope).toMatchObject({ points: [[2, 0]] })
    } finally {
      dispose()
    }
  })
  test('selecting an element or ⌘Z ends the draft; the next ⌘Z walks history', async () => {
    function Lifetime() {
      useDivideLifetime()
      return null
    }
    await withSelectionHarness(async ({ render }) => {
      await render(createElement(Lifetime))
      const wall = Object.values(useScene.getState().nodes).find((n) => n.type === 'wall')!
      startRoomDivide(zoneId, 'level_room_controls')
      previewRoomDivide([2, 0.2])
      clickRoomDivide()
      useViewer.getState().setSelection({ selectedIds: [wall.id] })
      expect(useInteractionScope.getState().scope.kind).toBe('idle')
      useViewer.getState().setSelection({ selectedIds: [] })

      expect(renameRoom(zoneId, 'Studio')).toBe(true)
      startRoomDivide(zoneId, 'level_room_controls')
      previewRoomDivide([2, 0.2])
      clickRoomDivide()
      expect(runHistoryShortcut('undo')).toBe(false)
      expect(useInteractionScope.getState().scope.kind).toBe('idle')
      expect(useScene.getState().nodes[zoneId as AnyNodeId]?.name).toBe('Studio')
      expect(runHistoryShortcut('undo')).toBe(true)
      expect(useScene.getState().nodes[zoneId as AnyNodeId]?.name).not.toBe('Studio')
      await render(null)
    })
  })
  test('a boundary change ends the draft; renaming the room does not', async () => {
    function Lifetime() {
      useDivideLifetime()
      return null
    }
    await withSelectionHarness(async ({ render }) => {
      await render(createElement(Lifetime))
      startRoomDivide(zoneId, 'level_room_controls')
      previewRoomDivide([2, 0.2])
      clickRoomDivide()
      renameRoom(zoneId, 'Kitchen')
      expect(useInteractionScope.getState().scope).toMatchObject({
        kind: 'room-divide',
        points: [[2, 0]],
      })
      const wall = Object.values(useScene.getState().nodes).find(
        (n): n is WallNode => n.type === 'wall' && n.start[1] === 0 && n.end[1] === 0,
      )!
      useScene.getState().updateNode(
        wall.id as AnyNodeId,
        {
          start: [wall.start[0], -0.5],
          end: [wall.end[0], -0.5],
        } as never,
      )
      expect(useInteractionScope.getState().scope.kind).toBe('idle')
      await render(null)
    })
  })
  test('an unchanged preview candidate writes nothing', () => {
    startRoomDivide(zoneId, 'level_room_controls')
    previewRoomDivide([2, 0.2])
    clickRoomDivide()
    let writes = 0
    const stop = useInteractionScope.subscribe(() => writes++)
    try {
      previewRoomDivide([2.1, 3.9])
      previewRoomDivide([2.2, 3.8])
      previewRoomDivide([1.9, 3.95])
      expect(writes).toBe(1)
    } finally {
      stop()
    }
  })
  test('unmount releases a pending Divide scope', async () => {
    function Lifetime() {
      useDivideLifetime()
      return null
    }
    await withSelectionHarness(async ({ render }) => {
      await render(createElement(Lifetime))
      startRoomDivide(zoneId, 'level_room_controls')
      previewRoomDivide([2, 0])
      clickRoomDivide()
      await render(null)
      expect(useInteractionScope.getState().scope.kind).toBe('idle')
      expect(resolveOverlayPolicy(useInteractionScope.getState().scope).sceneObjectsPickable).toBe(
        true,
      )
    })
  })
  test('3D Divide points land on the room floor behind a near wall; off the room reads outside', () => {
    // A camera south of the room looking down past the near (z = 0) wall: the
    // ray crosses the wall's footprint before it meets the floor inside.
    const origin: [number, number, number] = [4, 6, -6]
    const target: [number, number, number] = [4, 0.05, 1]
    const direction: [number, number, number] = [
      target[0] - origin[0],
      target[1] - origin[1],
      target[2] - origin[2],
    ]
    const point = divideFloorPoint(origin, direction, 0.05)!
    expect(point[0]).toBeCloseTo(4)
    expect(point[1]).toBeCloseTo(1)
    // A ray rising away from the floor never lands.
    expect(divideFloorPoint(origin, [0, 1, 1], 0.05)).toBeNull()
    startRoomDivide(zoneId, 'level_room_controls')
    previewRoomDivide(point)
    const scope = useInteractionScope.getState().scope as Parameters<typeof divideEndOutside>[0]
    // Snapped onto the near edge: on the room, not outside.
    expect(divideEndOutside(scope)).toBe(false)
    previewRoomDivide([2, 0.1])
    clickRoomDivide()
    previewRoomDivide([4, 2])
    expect(divideEndOutside(useInteractionScope.getState().scope as typeof scope)).toBe(false)
    previewRoomDivide([4, -3])
    expect(divideEndOutside(useInteractionScope.getState().scope as typeof scope)).toBe(true)
  })
  test('missing or open rooms and distant pointers invalidate instead of escaping DOM handlers', () => {
    startRoomDivide(zoneId, 'level_room_controls')
    expect(() => previewRoomDivide([4, 7])).not.toThrow()
    expect(useInteractionScope.getState().scope).toMatchObject({ valid: false, end: [4, 7] })
    expect(clickRoomDivide()).toBe(false)
    previewRoomDivide([2, 0])
    clickRoomDivide()
    previewRoomDivide([2, 4])
    const nodes = { ...useScene.getState().nodes }
    delete nodes[zoneId as AnyNodeId]
    useScene.setState({ nodes })
    // The gesture owner ends a draft whose room is gone; nothing throws after.
    expect(useInteractionScope.getState().scope.kind).toBe('idle')
    expect(clickRoomDivide()).toBe(false)
    expect(() => previewRoomDivide([2, 4])).not.toThrow()
    expect(useScene.temporal.getState().pastStates).toHaveLength(1)
    useScene.temporal.getState().undo()
    startRoomDivide(zoneId, 'level_room_controls')
    const wallsRemoved = Object.fromEntries(
      Object.entries(useScene.getState().nodes).filter(([, n]) => n.type !== 'wall'),
    )
    useScene.setState({ nodes: wallsRemoved })
    expect(useInteractionScope.getState().scope.kind).toBe('idle')
    expect(() => previewRoomDivide([2, 4])).not.toThrow()
    expect(clickRoomDivide()).toBe(false)
  })
  test('session face cache survives intent changes and rebuilds for topology changes', () => {
    startRoomDivide(zoneId, 'level_room_controls')
    const nodes = useScene.getState().nodes
    const first = roomDivideContext(nodes, zoneId)
    for (let i = 0; i < 10; i++) previewRoomDivide([2 + i * 0.01, 0])
    expect(roomDivideContext(nodes, zoneId)).toBe(first)
    renameRoom(zoneId, 'New name')
    expect(roomDivideContext(useScene.getState().nodes, zoneId)).toBe(first)
    const wall = Object.values(nodes).find((n) => n.type === 'wall')!
    const changed = { ...nodes, [wall.id]: { ...wall, end: [7, 0] as [number, number] } }
    expect(roomDivideContext(changed, zoneId)).not.toBe(first)
  })
  test('2D screen conversion and 3D plan pointers produce the same preview and one-step commit', async () => {
    const originalDocument = globalThis.document
    const before = useScene.getState().nodes
    let expected: ReturnType<typeof useInteractionScope.getState>['scope'] | undefined
    try {
      globalThis.document = {
        querySelector: () => ({
          getScreenCTM: () => ({ inverse: () => ({}) }),
          ownerSVGElement: {
            createSVGPoint: () => ({
              x: 0,
              y: 0,
              matrixTransform() {
                return { x: (this.x - 10) / 100, y: (this.y - 20) / 100 }
              },
            }),
          },
        }),
      } as unknown as Document
      for (const view of ['3d', '2d']) {
        useScene.setState({ nodes: before })
        clearSceneHistory()
        const surface = new EventTarget(),
          keyboard = new EventTarget()
        const dispose = bindDividePointer(
          surface,
          (event) =>
            view === '2d'
              ? resolveRoomDividePlanPoint(event.clientX, event.clientY)
              : { point: [event.clientX, event.clientY] },
          keyboard,
        )
        const send = (type: string, x: number, y: number) =>
          (type === 'pointerup' ? keyboard : surface).dispatchEvent(
            Object.assign(new Event(type), {
              button: 0,
              pointerId: 1,
              altKey: false,
              clientX: view === '2d' ? x * 100 + 10 : x,
              clientY: view === '2d' ? y * 100 + 20 : y,
            }),
          )
        try {
          startRoomDivide(zoneId, 'level_room_controls')
          send('pointerdown', 2.2, 0.1)
          send('pointerup', 2.2, 0.1)
          send('pointermove', 2.2, 3.9)
          const scope = useInteractionScope.getState().scope
          expect(scope).toMatchObject({ points: [[2, 0]], end: [2, 4], valid: true })
          if (view === '3d') expected = scope
          else expect(scope).toEqual(expected!)
          expect(useScene.temporal.getState().pastStates).toHaveLength(0)
          send('pointerdown', 2.2, 3.9)
          send('pointerup', 2.2, 3.9)
          expect(useScene.temporal.getState().pastStates).toHaveLength(1)
          expect(
            Object.values(useScene.getState().nodes).filter((n) => n.type === 'zone'),
          ).toHaveLength(2)
          expect(useInteractionScope.getState().scope.kind).toBe('idle')
        } finally {
          dispose()
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 1))
    } finally {
      globalThis.document = originalDocument
    }
  })
  test('confirmation describes counts and names, including opened neighbours, without raw IDs', () => {
    requestRoomDeletion(zoneId)
    const request = useDeleteConfirmation.getState().request!
    const payload = request.room!
    const nodes = useScene.getState().nodes
    const content = deleteConfirmationContent(
      { ...request, room: { ...payload, opensZoneIds: [zoneId] } },
      nodes,
    )
    expect(content.title).toBe(`Delete ${payload.name.trim() || 'this room'}?`)
    expect(content.description).toContain('Removes 4 walls')
    expect(content.description).toContain('Opens into Room.')
    expect(content.description).not.toContain(zoneId)
    for (const id of payload.wallIds) expect(content.description).not.toContain(id)
    const merge = deleteConfirmationContent(
      {
        ...request,
        room: { ...payload, mode: 'merge', wallIds: [], separatorIds: ['separator_a'] },
      },
      nodes,
    )
    expect(merge.description).toContain('Merges it back into')
    expect(merge.description).toContain('removes the dividing line')
    expect(merge.description).toContain('The walls stay')
    expect(merge.description).not.toContain('item')
  })
  test('Keep items is offered only when the room holds items', () => {
    requestRoomDeletion(zoneId)
    const empty = useDeleteConfirmation.getState().request!
    const nodes = useScene.getState().nodes
    expect(deleteConfirmationContent(empty, nodes)).toMatchObject({
      keepLabel: null,
      confirmLabel: 'Delete',
    })
    expect(deleteConfirmationContent(empty, nodes).description).not.toContain('item')
    const furnished = { ...empty, room: { ...empty.room!, itemIds: ['item_a', 'item_b'] } }
    expect(deleteConfirmationContent(furnished, nodes)).toMatchObject({
      keepLabel: 'Keep items',
      confirmLabel: 'Delete all',
    })
    expect(deleteConfirmationContent(furnished, nodes).description).toContain('2 items are inside')
    // A merged area's items stay whatever: no choice to offer, only a mention.
    const merged = { ...furnished, room: { ...furnished.room, mode: 'merge' as const } }
    expect(deleteConfirmationContent(merged, nodes)).toMatchObject({
      keepLabel: null,
      confirmLabel: 'Delete',
    })
    expect(deleteConfirmationContent(merged, nodes).description).toContain(
      '2 items inside stay where they are',
    )
    expect(deleteConfirmationContent({ count: 3, onConfirm: () => {} }, nodes)).toMatchObject({
      title: 'Delete 3 elements?',
      keepLabel: null,
    })
  })
  test('deleting one side of a split merges it into the other; that room stays selected', () => {
    applyRoomPlan(
      divideZone(useScene.getState().nodes, {
        zoneId,
        cut: [
          [2, 0],
          [2, 4],
        ],
        mintId: generateId,
      }),
    )
    const zones = () => Object.values(useScene.getState().nodes).filter((n) => n.type === 'zone')
    const other = zones().find((n) => n.id !== zoneId)!
    const walls = Object.values(useScene.getState().nodes).filter((n) => n.type === 'wall')
    useEditor.getState().selectRoom({ levelId: 'level_room_controls', zoneId: other.id })
    // As the mounted room hooks do: a selected room that is gone clears the selection.
    const stop = useScene.subscribe((state) => {
      const room = useEditor.getState().room
      if (room && !state.nodes[room.zoneId as AnyNodeId]) useEditor.getState().clearRoom()
    })
    requestRoomDeletion(other.id)
    const request = useDeleteConfirmation.getState().request!
    expect(request.room).toMatchObject({ mode: 'merge', mergedIntoZoneId: zoneId })
    expect(request.onKeepContents).toBeUndefined()
    useDeleteConfirmation.getState().confirm()
    stop()
    expect(zones().map((n) => n.id as string)).toEqual([zoneId])
    expect(Object.values(useScene.getState().nodes).filter((n) => n.type === 'separator')).toEqual(
      [],
    )
    expect(Object.values(useScene.getState().nodes).filter((n) => n.type === 'wall')).toEqual(walls)
    expect(useEditor.getState().room).toEqual({ levelId: 'level_room_controls', zoneId })
    expect(useScene.temporal.getState().pastStates).toHaveLength(2)
  })
  test('a room inside shared walls opens no dialog; the pill trash is off and says why', () => {
    const points: [number, number][] = [
      [-2, -2],
      [10, -2],
      [10, 6],
      [-2, 6],
    ]
    useScene.getState().applyNodeChanges({
      create: points.map((start, i) => ({
        node: WallNode.parse({
          parentId: 'level_room_controls',
          start,
          end: points[(i + 1) % 4],
        }),
        parentId: 'level_room_controls' as AnyNodeId,
      })),
    })
    expect(Object.values(useScene.getState().nodes).filter((n) => n.type === 'zone')).toHaveLength(
      2,
    )
    const before = useScene.getState().nodes
    requestRoomDeletion(zoneId)
    expect(useDeleteConfirmation.getState().request).toBeNull()
    expect(useRoomTransform.getState().notice).toEqual({
      zoneId,
      message: SHARED_WALLS_DELETE_MESSAGE,
    })
    expect(useScene.getState().nodes).toBe(before)
    expect(roomDeleteBlockedReason(useScene.getState().nodes, zoneId)).toBe(
      SHARED_WALLS_DELETE_MESSAGE,
    )
    const pill = (reason?: string) =>
      renderToStaticMarkup(
        createElement(NodeActionMenu, {
          deleteDisabledReason: reason,
          deleteLabel: 'Delete room',
          onDelete: () => {},
          onDuplicate: () => {},
          onMove: () => {},
          onRotateLeft: () => {},
          onRotateRight: () => {},
        }),
      )
    const trash = (html: string) =>
      html.match(/<button[^>]*aria-label="Delete room"[^>]*>/)?.[0] ?? ''
    expect(trash(pill(SHARED_WALLS_DELETE_MESSAGE))).toContain('aria-disabled="true"')
    expect(trash(pill())).not.toContain('aria-disabled')
    // Every pill button is named for the editor tooltip; none uses the browser's title.
    const html = pill()
    for (const label of ['Move', 'Rotate left', 'Rotate right', 'Duplicate', 'Delete room'])
      expect(html).toContain(`aria-label="${label}"`)
    expect(html).not.toMatch(/<button[^>]* title=/)
  })
})

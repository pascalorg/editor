import { afterAll, afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  type AnyNode,
  type AnyNodeId,
  BuildingNode,
  clearSceneHistory,
  createZone,
  generateId,
  initSpaceDetectionSync,
  LevelNode,
  useLiveNodeOverrides,
  useScene,
  type WallNode,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import type { ThreeEvent } from '@react-three/fiber'
import { createElement } from 'react'
import { Object3D, OrthographicCamera, Raycaster } from 'three'
import { startHandleDrag } from '../components/editor/handles/use-handle-drag'
import { runHistoryShortcut } from '../hooks/use-keyboard'
import useEditor from '../store/use-editor'
import useInteractionScope from '../store/use-interaction-scope'
import { withSelectionHarness } from '../test-utils/selection-harness'
import {
  FLOOR_PAINT_REGION_HANDLE,
  pressFloorRegion,
  useFloorRegionDraft,
} from './floor-region-session'
import { floorRegionSnapTargets } from './floor-region-snap'
import {
  beginGesture,
  cancelGestures,
  hasLiveGestures,
  liveGestureKinds,
  useGestureLifecycleOwner,
} from './gesture-lifecycle'
import { runUndo } from './history'
import { usePaintRegionMode } from './paint-region-mode'
import { startRoomDivide } from './room-divide-session'
import {
  getActiveRoomHandleDrag,
  ROOM_ELEVATION_DRAG_LABEL,
  runRoomHandleDrag,
} from './room-handle-drag'
import { applyRoomPlan } from './room-structure-commands'
import { startRoomTransform, useRoomTransform } from './room-transform-session'
import {
  activeWallRegionGesture,
  pressWallRegion,
  useWallPaintRegionSession,
  WALL_PAINT_REGION_HANDLE,
} from './wall-paint-region-session'

// Every gesture kind × every cancel trigger: the lifecycle owner must end the
// gesture synchronously, drop its own state, and release its own scope.

const LEVEL = 'level_lifecycle'

type Listener = (event: unknown) => void
const listeners = new Map<string, Set<Listener>>()
const fakeWindow = {
  addEventListener: (type: string, listener: Listener) => {
    const set = listeners.get(type) ?? new Set()
    set.add(listener)
    listeners.set(type, set)
  },
  removeEventListener: (type: string, listener: Listener) => listeners.get(type)?.delete(listener),
  requestAnimationFrame: (callback: (time: number) => void) => {
    callback(0)
    return 0
  },
  cancelAnimationFrame: () => {},
}
function fire(type: string, event: object = {}) {
  for (const listener of [...(listeners.get(type) ?? [])]) listener(event)
}

const saved = {
  window: globalThis.window,
  document: globalThis.document,
  raf: globalThis.requestAnimationFrame,
  caf: globalThis.cancelAnimationFrame,
}

let zoneId = ''
let wallId = ''
let stopSpaces = () => {}

function nodes() {
  return useScene.getState().nodes
}

function installGlobals() {
  globalThis.window = fakeWindow as unknown as Window & typeof globalThis
  globalThis.document = { body: { style: { cursor: '' } } } as unknown as Document
  globalThis.requestAnimationFrame =
    fakeWindow.requestAnimationFrame as typeof requestAnimationFrame
  globalThis.cancelAnimationFrame = () => {}
}

beforeEach(() => {
  installGlobals()
  listeners.clear()
  cancelGestures('cancel')
  useInteractionScope.getState().end()
  const building = BuildingNode.parse({ id: 'building_lifecycle', children: [LEVEL] })
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
  stopSpaces = initSpaceDetectionSync(useScene, {
    getState: () => ({ spaces: {}, setSpaces: () => {} }),
  })
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
  zoneId = plan.zoneId
  wallId = Object.values(nodes()).find((node): node is WallNode => node.type === 'wall')!.id
  // A change the history can undo, so `runUndo` really jumps.
  clearSceneHistory()
  useScene.getState().updateNode(zoneId as AnyNodeId, { name: 'Studio' } as never)
  useViewer.getState().setSelection({ buildingId: building.id, levelId: LEVEL, selectedIds: [] })
  useEditor.setState({
    phase: 'structure',
    mode: 'select',
    tool: null,
    room: { zoneId, levelId: LEVEL },
    activePaintMaterial: { materialPreset: 'library:tile', sourceTarget: 'wall' } as never,
  })
  usePaintRegionMode.getState().setMode('surface')
})

afterEach(() => {
  cancelGestures('cancel')
  stopSpaces()
  useRoomTransform.setState({ session: null })
  useFloorRegionDraft.setState({ draft: null, hover: null })
  usePaintRegionMode.getState().setMode('surface')
  useEditor.setState({ mode: 'select', activePaintMaterial: null })
})

afterAll(async () => {
  // Click swallowing and input-drag release run on short timers; let them fire.
  await new Promise((resolve) => setTimeout(resolve, 350))
  globalThis.window = saved.window
  globalThis.document = saved.document
  globalThis.requestAnimationFrame = saved.raf
  globalThis.cancelAnimationFrame = saved.caf
})

function enterPaint(subMode: 'rectangle' | 'polygon') {
  useEditor.setState({ mode: 'material-paint' })
  useInteractionScope.getState().begin({ kind: 'painting' })
  usePaintRegionMode.getState().setMode(subMode)
}

type Kind = {
  name: string
  paint?: boolean
  /** The node whose deletion makes the gesture stale. */
  target: () => string
  start: () => void
  /** The gesture's own in-flight state is gone. */
  cleared: () => boolean
  ownsScope: () => boolean
}

let dragging = false

const kinds: Kind[] = [
  {
    name: 'wall-paint-region',
    paint: true,
    target: () => wallId,
    start: () => {
      enterPaint('rectangle')
      expect(
        pressWallRegion(
          {
            wallId,
            face: 'a',
            u: 1,
            v: 0.4,
            length: 6,
            extent: { uMin: 0, uMax: 6, top: 2.5 },
            runs: null,
          },
          { mode: 'off', gridStep: 0.5, tolerance: 0.1 },
        ),
      ).toBe(true)
    },
    cleared: () => useWallPaintRegionSession.getState().preview === null,
    ownsScope: () => {
      const scope = useInteractionScope.getState().scope
      return scope.kind === 'handle-drag' && scope.handle === WALL_PAINT_REGION_HANDLE
    },
  },
  {
    name: 'floor-paint-region',
    paint: true,
    target: () => zoneId,
    start: () => {
      enterPaint('polygon')
      const clear = [
        {
          outer: [
            [0.15, 0.15],
            [5.85, 0.15],
            [5.85, 3.85],
            [0.15, 3.85],
          ] as [number, number][],
          holes: [],
        },
      ]
      pressFloorRegion(
        'polygon',
        {
          zoneId,
          levelId: LEVEL,
          clear,
          elevation: 0,
          angle: 0,
          targets: floorRegionSnapTargets(clear),
        },
        [1, 1],
        { mode: 'off', step: 0.5 },
        0.2,
      )
      expect(useFloorRegionDraft.getState().draft).not.toBeNull()
    },
    cleared: () => useFloorRegionDraft.getState().draft === null,
    ownsScope: () => {
      const scope = useInteractionScope.getState().scope
      return scope.kind === 'handle-drag' && scope.handle === FLOOR_PAINT_REGION_HANDLE
    },
  },
  {
    name: 'handle-drag',
    target: () => wallId,
    start: () => {
      const wall = nodes()[wallId as AnyNodeId] as AnyNode
      startHandleDrag(
        {
          kind: 'drag',
          cursor: 'ns-resize',
          dragControls: { onStart: () => {}, onEnd: () => {} },
          handleIndex: 0,
          node: wall,
          rideObject: new Object3D(),
          setIsDragging: (next) => {
            dragging = next
          },
          onStart: () => ({
            onBegin: () =>
              useInteractionScope
                .getState()
                .begin({ kind: 'handle-drag', nodeId: wallId, handle: 'height' }),
            onEnd: () =>
              useInteractionScope
                .getState()
                .endIf((scope) => scope.kind === 'handle-drag' && scope.handle === 'height'),
            move: () => ({ height: 3 }) as Partial<AnyNode>,
          }),
        },
        pointerDown(),
        three(),
        { current: null },
      )
      expect(dragging).toBe(true)
      // Under the React harness the window is not this file's listener map.
      if (globalThis.window === (fakeWindow as unknown)) {
        fire('pointermove', { clientX: 1, clientY: 1 })
        expect(useLiveNodeOverrides.getState().overrides.has(wallId)).toBe(true)
      }
    },
    cleared: () => !dragging && !useLiveNodeOverrides.getState().overrides.has(wallId),
    ownsScope: () => {
      const scope = useInteractionScope.getState().scope
      return scope.kind === 'handle-drag' && scope.handle === 'height'
    },
  },
  {
    name: 'room-handle-drag',
    target: () => zoneId,
    start: () => {
      runRoomHandleDrag({
        label: ROOM_ELEVATION_DRAG_LABEL,
        nodeId: zoneId,
        zoneId,
        levelId: LEVEL,
        requires: [zoneId],
        sample: () => 0.2,
        onValue: () => {},
        onCommit: () => {},
        onCancel: () => {},
      })
    },
    cleared: () => getActiveRoomHandleDrag() === null,
    ownsScope: () => {
      const scope = useInteractionScope.getState().scope
      return scope.kind === 'handle-drag' && scope.handle === ROOM_ELEVATION_DRAG_LABEL
    },
  },
  {
    name: 'room-transform',
    target: () => zoneId,
    start: () => {
      expect(
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
        }),
      ).toBe(true)
    },
    cleared: () => useRoomTransform.getState().session === null,
    ownsScope: () => {
      const scope = useInteractionScope.getState().scope
      return scope.kind === 'handle-drag' && scope.nodeId === zoneId
    },
  },
  {
    name: 'room-divide',
    target: () => zoneId,
    start: () => startRoomDivide(zoneId, LEVEL),
    cleared: () => useInteractionScope.getState().scope.kind !== 'room-divide',
    ownsScope: () => useInteractionScope.getState().scope.kind === 'room-divide',
  },
]

function pointerDown() {
  return {
    button: 0,
    pointerId: 7,
    stopPropagation: () => {},
    nativeEvent: { altKey: false, pointerId: 7, clientX: 0, clientY: 0 },
  } as unknown as ThreeEvent<PointerEvent>
}

function three() {
  return {
    camera: new OrthographicCamera(-1, 1, 1, -1),
    raycaster: new Raycaster(),
    gl: {
      domElement: { getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 }) },
    },
  } as unknown as Parameters<typeof startHandleDrag>[2]
}

type Trigger = { name: string; paintOnly?: boolean; fire: (kind: Kind) => void }

const triggers: Trigger[] = [
  {
    name: 'mode switch',
    fire: (kind) => useEditor.setState({ mode: kind.paint ? 'select' : 'delete' }),
  },
  { name: 'tool switch', fire: () => useEditor.setState({ tool: 'wall' }) },
  {
    name: 'paint sub-mode switch',
    paintOnly: true,
    fire: () =>
      usePaintRegionMode
        .getState()
        .setMode(usePaintRegionMode.getState().mode === 'rectangle' ? 'polygon' : 'rectangle'),
  },
  { name: 'phase switch', fire: () => useEditor.setState({ phase: 'furnish' }) },
  {
    name: 'level change',
    fire: () => useViewer.getState().setSelection({ levelId: 'level_other' }),
  },
  {
    name: 'selection change',
    fire: (kind) =>
      useViewer
        .getState()
        .setSelection({ selectedIds: [kind.target() === wallId ? zoneId : wallId] }),
  },
  {
    name: 'scope replaced',
    fire: () => useInteractionScope.getState().begin({ kind: 'box-select' }),
  },
  {
    name: 'target deleted',
    fire: (kind) => {
      const next = { ...nodes() }
      delete next[kind.target() as AnyNodeId]
      useScene.setState({ nodes: next })
    },
  },
  { name: 'direct undo (toolbar, command palette)', fire: () => void runUndo() },
  // Consumed as an abort: no history jump (`false`).
  { name: 'keyboard undo', fire: () => expect(runHistoryShortcut('undo')).toBe(false) },
]

describe('gesture lifecycle: every trigger ends every gesture kind', () => {
  for (const kind of kinds) {
    for (const trigger of triggers) {
      if (trigger.paintOnly && !kind.paint) continue
      test(`${kind.name} × ${trigger.name}`, () => {
        kind.start()
        expect(liveGestureKinds()).toEqual([kind.name])
        expect(kind.ownsScope()).toBe(true)
        trigger.fire(kind)
        expect(hasLiveGestures()).toBe(false)
        expect(kind.cleared()).toBe(true)
        expect(kind.ownsScope()).toBe(false)
      })
    }
  }

  test('keyboard undo under a live gesture aborts it without a history jump; direct undo also jumps', () => {
    const room = kinds.find((kind) => kind.name === 'room-divide')!
    room.start()
    expect(runHistoryShortcut('undo')).toBe(false)
    expect(hasLiveGestures()).toBe(false)
    expect(nodes()[zoneId as AnyNodeId]?.name).toBe('Studio')
    room.start()
    runUndo()
    expect(hasLiveGestures()).toBe(false)
    expect(nodes()[zoneId as AnyNodeId]?.name).not.toBe('Studio')
  })

  test('a paint gesture hands the paint mode its scope back; a replacing scope is left alone', () => {
    const wall = kinds[0]!
    wall.start()
    usePaintRegionMode.getState().setMode('polygon')
    expect(useInteractionScope.getState().scope.kind).toBe('painting')
    wall.start()
    useInteractionScope.getState().begin({ kind: 'box-select' })
    expect(useInteractionScope.getState().scope.kind).toBe('box-select')
  })

  test('the lifecycle releases pointer capture when a gesture is cancelled', () => {
    const captured = new Set<number>()
    const target = {
      setPointerCapture: (id: number) => captured.add(id),
      hasPointerCapture: (id: number) => captured.has(id),
      releasePointerCapture: (id: number) => captured.delete(id),
    }
    kinds[0]!.start()
    activeWallRegionGesture()!.capturePointer(target, 3)
    expect(captured.has(3)).toBe(true)
    useViewer.getState().setSelection({ levelId: 'level_other' })
    expect(captured.size).toBe(0)
  })
})

describe('unmount', () => {
  for (const kind of kinds) {
    test(`${kind.name}: the editor unmounting cancels it`, async () => {
      function Owner() {
        useGestureLifecycleOwner()
        return null
      }
      await withSelectionHarness(async ({ render }) => {
        await render(createElement(Owner))
        kind.start()
        expect(hasLiveGestures()).toBe(true)
        await render(null)
        expect(hasLiveGestures()).toBe(false)
        expect(kind.cleared()).toBe(true)
        expect(kind.ownsScope()).toBe(false)
      })
      installGlobals()
    })
  }
})

describe('throwing commits', () => {
  test('a throwing finish still releases the scope and leaves the owner', () => {
    const owner = beginGesture({
      kind: 'probe',
      scope: { kind: 'handle-drag', nodeId: wallId, handle: 'probe' },
      onCancel: () => {},
    })
    expect(() =>
      owner.finish(() => {
        throw new Error('write failed')
      }),
    ).toThrow('write failed')
    expect(owner.active).toBe(false)
    expect(hasLiveGestures()).toBe(false)
    expect(useInteractionScope.getState().scope.kind).toBe('idle')
  })

  test('a handle drag whose commit throws ends: override cleared, history resumed, scope released', () => {
    const wall = nodes()[wallId as AnyNodeId] as AnyNode
    let ended = 0
    startHandleDrag(
      {
        kind: 'drag',
        cursor: 'ns-resize',
        dragControls: { onStart: () => {}, onEnd: () => ended++ },
        handleIndex: 0,
        node: wall,
        rideObject: new Object3D(),
        setIsDragging: (next) => {
          dragging = next
        },
        onStart: () => ({
          onBegin: () =>
            useInteractionScope
              .getState()
              .begin({ kind: 'handle-drag', nodeId: wallId, handle: 'height' }),
          onEnd: () =>
            useInteractionScope
              .getState()
              .endIf((scope) => scope.kind === 'handle-drag' && scope.handle === 'height'),
          move: () => ({ height: 3 }) as Partial<AnyNode>,
          commit: () => {
            throw new Error('commit failed')
          },
        }),
      },
      pointerDown(),
      three(),
      { current: null },
    )
    fire('pointermove', { clientX: 1, clientY: 1 })
    expect(() => fire('pointerup', { clientX: 1, clientY: 1 })).toThrow('commit failed')
    expect(dragging).toBe(false)
    expect(ended).toBe(1)
    expect(hasLiveGestures()).toBe(false)
    expect(useLiveNodeOverrides.getState().overrides.has(wallId)).toBe(false)
    expect(useScene.temporal.getState().isTracking).toBe(true)
    expect(useInteractionScope.getState().scope.kind).toBe('idle')
    expect(listeners.get('pointermove')?.size ?? 0).toBe(0)
    // A later Escape finds nothing to cancel.
    fire('keydown', { key: 'Escape', preventDefault: () => {}, stopPropagation: () => {} })
    expect(ended).toBe(1)
  })

  test('a room handle drag whose commit throws still cleans up once', () => {
    runRoomHandleDrag({
      label: ROOM_ELEVATION_DRAG_LABEL,
      nodeId: zoneId,
      zoneId,
      levelId: LEVEL,
      requires: [zoneId],
      sample: () => 0.2,
      onValue: () => {},
      onCommit: () => {
        throw new Error('commit failed')
      },
      onCancel: () => {},
    })
    expect(() => fire('pointerup', { clientX: 1, clientY: 1 })).toThrow('commit failed')
    expect(getActiveRoomHandleDrag()).toBeNull()
    expect(hasLiveGestures()).toBe(false)
    expect(useInteractionScope.getState().scope.kind).toBe('idle')
  })

  test('the handle drag keyboard leaves typing targets alone', () => {
    kinds[2]!.start()
    const input = { closest: (selector: string) => (selector.includes('input') ? {} : null) }
    fire('keydown', {
      key: 'Escape',
      target: input,
      preventDefault: () => {},
      stopPropagation: () => {},
    })
    expect(liveGestureKinds()).toEqual(['handle-drag'])
    fire('keydown', {
      key: 'Escape',
      target: null,
      preventDefault: () => {},
      stopPropagation: () => {},
    })
    expect(hasLiveGestures()).toBe(false)
  })
})

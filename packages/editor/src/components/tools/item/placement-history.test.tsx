import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  type AnyNodeId,
  type AssetInput,
  acquireSceneHistoryPause,
  beginSceneHistoryPauseSession,
  clearSceneHistory,
  emitter,
  getSceneHistoryPauseDepth,
  ItemNode,
  initSpaceDetectionSync,
  LevelNode,
  pauseSceneHistory,
  resumeSceneHistory,
  type SceneCommit,
  sceneRegistry,
  spatialGridManager,
  subscribeSceneCommits,
  useLiveNodeOverrides,
  useLiveTransforms,
  useScene,
  WallNode,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { Html } from '@react-three/drei'
import { act, create } from '@react-three/test-renderer'
import { Children, Component, cloneElement, isValidElement, type ReactNode } from 'react'
import { Group } from 'three'
import useEditor from '../../../store/use-editor'
import useInteractionScope from '../../../store/use-interaction-scope'
import { useDraftNode } from './use-draft-node'
import { usePlacementCoordinator } from './use-placement-coordinator'

// The item move / placement history contract, driven through the real placement coordinator
// with core's space-detection sync attached. The carry pauses no history: the draft is kept out
// of history snapshots, so the drop is one ordinary tracked step, a write someone else makes
// mid-carry is its own step (in commit order, reconciled by space detection), and undoing that
// step mid-carry leaves the draft alone. Every exit path releases only its own pauses.

const level = LevelNode.parse({ id: 'level_placement_history', level: 0 })
const wallA = WallNode.parse({
  id: 'wall_placement_history_a',
  parentId: level.id,
  start: [-6, -6],
  end: [6, -6],
})
const wallB = WallNode.parse({
  id: 'wall_placement_history_b',
  parentId: level.id,
  start: [6, -6],
  end: [6, 6],
})
const wallC = WallNode.parse({
  id: 'wall_placement_history_c',
  parentId: level.id,
  start: [6, 6],
  end: [-6, 6],
})
const closingWall = WallNode.parse({
  id: 'wall_placement_history_closing',
  parentId: level.id,
  start: [-6, 6],
  end: [-6, -6],
})
const bathtub: AssetInput = {
  id: 'bathtub',
  name: 'Bathtub',
  category: 'bathroom',
  thumbnail: '',
  src: '/bathtub.glb',
  dimensions: [1.7, 0.6, 0.8],
}
const item = ItemNode.parse({
  id: 'item_placement_history_bathtub',
  parentId: level.id,
  asset: bathtub,
  position: [0, 0, 0],
  rotation: [0, 0, 0],
})

let savedScene: ReturnType<typeof useScene.getState>
let savedEditor: ReturnType<typeof useEditor.getState>
let savedViewer: ReturnType<typeof useViewer.getState>
let savedScope: ReturnType<typeof useInteractionScope.getState>
let restoreGlobals: () => void
let stopSpaceDetection: () => void

beforeEach(() => {
  savedScene = useScene.getState()
  savedEditor = useEditor.getState()
  savedViewer = useViewer.getState()
  savedScope = useInteractionScope.getState()
  const names = ['window', 'document', 'requestAnimationFrame', 'cancelAnimationFrame'] as const
  const descriptors = names.map((name) => Object.getOwnPropertyDescriptor(globalThis, name))
  restoreGlobals = () =>
    names.forEach((name, i) => {
      const descriptor = descriptors[i]
      if (descriptor) Object.defineProperty(globalThis, name, descriptor)
      else Reflect.deleteProperty(globalThis, name)
    })
  globalThis.window = new EventTarget() as Window & typeof globalThis
  globalThis.document = { body: { style: { cursor: '' } } } as Document
  globalThis.requestAnimationFrame = () => 0
  globalThis.cancelAnimationFrame = () => {}

  useScene.setState({
    nodes: {
      [level.id]: { ...level, children: [wallA.id, wallB.id, wallC.id, item.id] },
      [wallA.id]: structuredClone(wallA),
      [wallB.id]: structuredClone(wallB),
      [wallC.id]: structuredClone(wallC),
      [item.id]: structuredClone(item),
    },
    rootNodeIds: [level.id],
    collections: {},
    materials: {},
    dirtyNodes: new Set(),
    readOnly: false,
  } as never)
  clearSceneHistory()
  spatialGridManager.clear()
  useLiveNodeOverrides.getState().clearAll()
  useLiveTransforms.getState().clearAll()
  useInteractionScope.getState().end()
  useEditor.setState({
    mode: 'build',
    tool: 'item',
    movingNodeOrigin: '3d',
    placementDragMode: false,
  })
  useEditor.getState().setSnappingMode('item', 'grid')
  useEditor.setState({ gridSnapStep: 0.1 })
  useViewer.setState({
    selection: { buildingId: null, levelId: level.id, zoneId: null, selectedIds: [] },
  })
  sceneRegistry.nodes.set(level.id, new Group())
  stopSpaceDetection = initSpaceDetectionSync(useScene, {
    getState: () => ({ spaces: {}, setSpaces: () => {} }),
  })
})

afterEach(() => {
  stopSpaceDetection()
  sceneRegistry.nodes.clear()
  spatialGridManager.clear()
  useLiveNodeOverrides.getState().clearAll()
  useLiveTransforms.getState().clearAll()
  clearSceneHistory()
  useScene.setState(savedScene)
  useEditor.setState(savedEditor)
  useViewer.setState(savedViewer)
  useInteractionScope.setState(savedScope)
  restoreGlobals()
})

// The DOM-only measurement labels need a canvas; the cursor refs they sit beside do not.
function withoutLabels(element: ReactNode): ReactNode {
  if (!isValidElement<{ children?: ReactNode }>(element)) return element
  if (element.type === Html) return null
  return cloneElement(element, {}, Children.map(element.props.children, withoutLabels))
}

function Placement({
  source,
  repeat = false,
  failSetup = false,
}: {
  source?: ItemNode
  repeat?: boolean
  failSetup?: boolean
}) {
  const draftNode = useDraftNode()
  return withoutLabels(
    usePlacementCoordinator({
      asset: source?.asset ?? bathtub,
      draftNode,
      initDraft: (position) => {
        if (failSetup) throw new Error('injected setup failure')
        if (source) {
          draftNode.adopt(source)
          position.set(...draftNode.current!.position)
        } else draftNode.create(position, bathtub)
      },
      onCommitted: () => repeat,
      onCancel: () => draftNode.destroy(),
    }),
  )
}

class SetupBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  render() {
    return this.state.failed ? null : this.props.children
  }
}

const history = () => {
  const temporal = useScene.temporal.getState()
  return {
    past: temporal.pastStates.length,
    tracking: temporal.isTracking,
    depth: getSceneHistoryPauseDepth(),
  }
}
const liveItem = () => useScene.getState().nodes[item.id as AnyNodeId] as ItemNode
const levelItems = () =>
  Object.values(useScene.getState().nodes).filter(
    (node) => node.type === 'item' && !node.metadata?.isTransient,
  )

async function grid(kind: 'move' | 'click', x: number, z = 0) {
  await act(async () => {
    emitter.emit(`grid:${kind}`, {
      position: [x, 0, z],
      localPosition: [x, 0, z],
      nativeEvent: {},
      stopPropagation() {},
    } as never)
    await new Promise((resolve) => setTimeout(resolve, 5))
  })
}

async function carry(from: number, to: number) {
  for (let step = from; step <= to; step++) await grid('move', step * 0.1, 0.5)
}

/** Another refcounted owner's balanced pause/resume pair landing mid-carry. */
function foreignPausePair() {
  pauseSceneHistory(useScene)
  resumeSceneHistory(useScene)
}

/** Someone else closes the room mid-carry; the space-detection sync owes it a slab and ceiling. */
function closeRoom() {
  useScene.getState().createNode(structuredClone(closingWall), level.id as AnyNodeId)
}
const autoRoomNodes = () =>
  Object.values(useScene.getState().nodes).filter(
    (node) => (node.type === 'slab' || node.type === 'ceiling') && 'autoFromWalls' in node,
  )
const hasNode = (id: string) => Boolean(useScene.getState().nodes[id as AnyNodeId])

describe('item move history', () => {
  test('a move adds one entry and one undo restores the item', async () => {
    const before = history()
    const renderer = await create(<Placement source={item} />)
    try {
      await carry(1, 6)
      expect(history().past).toBe(before.past)
      await grid('click', 0.6, 0.5)
    } finally {
      await renderer.unmount()
    }
    expect(liveItem().position.map((value) => Number(value.toFixed(6)))).toEqual([0.6, 0, 0.5])
    expect(history()).toEqual({ past: before.past + 1, tracking: true, depth: 0 })
    useScene.temporal.getState().undo()
    expect(liveItem()).toEqual(item)
  })

  test('a foreign pause owner mid-carry leaves the drop one entry', async () => {
    const before = history()
    const renderer = await create(<Placement source={item} />)
    try {
      await carry(1, 3)
      foreignPausePair()
      await carry(4, 6)
      expect(history().past).toBe(before.past)
      await grid('click', 0.6, 0.5)
    } finally {
      await renderer.unmount()
    }
    expect(history()).toEqual({ past: before.past + 1, tracking: true, depth: 0 })
    useScene.temporal.getState().undo()
    expect(liveItem()).toEqual(item)
  })

  test('a room closed mid-carry is its own step, in commit order, before the drop', async () => {
    const before = history()
    const commits: SceneCommit[] = []
    const stop = subscribeSceneCommits((commit) => commits.push(commit))
    const renderer = await create(<Placement source={item} />)
    try {
      await carry(1, 3)
      closeRoom()
      expect(history().past).toBe(before.past + 1)
      await carry(4, 6)
      await grid('click', 0.6, 0.5)
    } finally {
      await renderer.unmount()
      stop()
    }
    expect(history()).toEqual({ past: before.past + 2, tracking: true, depth: 0 })
    expect(
      autoRoomNodes()
        .map((node) => node.type)
        .sort(),
    ).toEqual(['ceiling', 'slab'])
    const local = commits.filter((commit) => commit.origin === 'local')
    expect(
      local.map(
        (commit) =>
          Boolean(commit.current.nodes[closingWall.id as AnyNodeId]) &&
          !commit.before.nodes[closingWall.id as AnyNodeId],
      ),
    ).toEqual([true, false])
    const dropped = local[1]!.current.nodes[item.id as AnyNodeId] as ItemNode
    expect(dropped.position.map((value) => Number(value.toFixed(6)))).toEqual([0.6, 0, 0.5])
    // The draft never reaches history: every recorded snapshot has the item as it was.
    expect(local[0]!.current.nodes[item.id as AnyNodeId]).toEqual(item)

    useScene.temporal.getState().undo()
    expect(liveItem()).toEqual(item)
    expect(hasNode(closingWall.id)).toBe(true)
    expect(autoRoomNodes()).toHaveLength(2)

    useScene.temporal.getState().undo()
    expect(liveItem()).toEqual(item)
    expect(hasNode(closingWall.id)).toBe(false)
    expect(autoRoomNodes()).toHaveLength(0)
    expect(history().past).toBe(before.past)
  })

  test('undoing the foreign step mid-carry leaves the draft where it is', async () => {
    const before = history()
    const renderer = await create(<Placement source={item} />)
    try {
      await carry(1, 3)
      closeRoom()
      const carried = liveItem()
      useScene.temporal.getState().undo()
      expect(hasNode(closingWall.id)).toBe(false)
      expect(liveItem()).toEqual(carried)
      await carry(4, 6)
      await grid('click', 0.6, 0.5)
    } finally {
      await renderer.unmount()
    }
    expect(history()).toEqual({ past: before.past + 1, tracking: true, depth: 0 })
    expect(liveItem().position.map((value) => Number(value.toFixed(6)))).toEqual([0.6, 0, 0.5])
    useScene.temporal.getState().undo()
    expect(liveItem()).toEqual(item)
  })

  test('a room closed during a cancelled carry is its own step and the item is unchanged', async () => {
    const before = history()
    const renderer = await create(<Placement source={item} />)
    try {
      await carry(1, 3)
      closeRoom()
      await act(async () => {
        emitter.emit('tool:cancel')
      })
    } finally {
      await renderer.unmount()
    }
    expect(liveItem()).toEqual(item)
    expect(history()).toEqual({ past: before.past + 1, tracking: true, depth: 0 })
    useScene.temporal.getState().undo()
    expect(hasNode(closingWall.id)).toBe(false)
    expect(liveItem()).toEqual(item)
  })

  test('cancel and unmount add no entry and restore the item', async () => {
    for (const exit of ['cancel', 'unmount'] as const) {
      const before = history()
      const renderer = await create(<Placement source={item} />)
      await carry(1, 4)
      if (exit === 'cancel') await act(async () => emitter.emit('tool:cancel'))
      await renderer.unmount()
      expect(liveItem()).toEqual(item)
      expect(history()).toEqual({ past: before.past, tracking: true, depth: 0 })
    }
  })

  test('with history at its 50-entry limit, the wall step and the drop still undo in order', async () => {
    for (let index = 0; index < 60; index++) {
      useScene.getState().updateNode(wallA.id as AnyNodeId, { thickness: 0.1 + index / 1000 })
    }
    expect(history().past).toBe(50)
    const renderer = await create(<Placement source={item} />)
    try {
      await carry(1, 3)
      closeRoom()
      await grid('click', 0.3, 0.5)
    } finally {
      await renderer.unmount()
    }
    expect(history().past).toBe(50)
    useScene.temporal.getState().undo()
    expect(liveItem()).toEqual(item)
    expect(hasNode(closingWall.id)).toBe(true)
    useScene.temporal.getState().undo()
    expect(hasNode(closingWall.id)).toBe(false)
  })

  test('in split view the 2D overlay co-owns the gesture, and the 3D drop is one step', async () => {
    useEditor.getState().setMovingNode(item)
    const overlay = beginSceneHistoryPauseSession(useScene, { gesture: item.id })
    const before = history()
    const renderer = await create(<Placement source={item} />)
    try {
      await carry(1, 6)
      await grid('click', 0.6, 0.5)
    } finally {
      await renderer.unmount()
      overlay.end()
    }
    expect(history()).toEqual({ past: before.past + 1, tracking: true, depth: 0 })
    useScene.temporal.getState().undo()
    expect(liveItem()).toEqual(item)
  })

  test("never releases another owner's pause on commit or unmount", async () => {
    const releaseOuter = acquireSceneHistoryPause(useScene)
    const before = history()
    const renderer = await create(<Placement source={item} />)
    try {
      await carry(1, 6)
      await grid('click', 0.6, 0.5)
      expect(history().tracking).toBe(false)
    } finally {
      await renderer.unmount()
    }
    expect(history()).toEqual({ past: before.past, tracking: false, depth: 1 })
    releaseOuter()
    expect(history()).toEqual({ past: before.past, tracking: true, depth: 0 })
  })

  test('repeat placement adds one entry per drop', async () => {
    const before = history()
    const itemsBefore = levelItems().length
    const renderer = await create(<Placement repeat />)
    try {
      await carry(10, 14)
      await grid('click', 1.4, 0.5)
      expect(history().past).toBe(before.past + 1)
      await carry(20, 24)
      foreignPausePair()
      await grid('click', 2.4, 0.5)
      expect(history().past).toBe(before.past + 2)
      await carry(30, 32)
    } finally {
      await renderer.unmount()
    }
    expect(history()).toEqual({ past: before.past + 2, tracking: true, depth: 0 })
    expect(levelItems()).toHaveLength(itemsBefore + 2)
    useScene.temporal.getState().undo()
    expect(levelItems()).toHaveLength(itemsBefore + 1)
    expect(liveItem()).toEqual(item)
  })

  test('a setup failure cannot leave history paused', async () => {
    const before = history()
    const reportError = globalThis.reportError
    const consoleError = console.error
    globalThis.reportError = () => {}
    console.error = () => {}
    try {
      const renderer = await create(
        <SetupBoundary>
          <Placement failSetup source={item} />
        </SetupBoundary>,
      )
      await renderer.unmount()
    } finally {
      globalThis.reportError = reportError
      console.error = consoleError
    }
    expect(history()).toEqual({ past: before.past, tracking: true, depth: 0 })
  })
})

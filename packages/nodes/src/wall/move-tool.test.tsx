import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test'
import * as core from '@pascal-app/core'
import {
  type AnyNode,
  type AnyNodeId,
  beginSceneHistoryPauseSession,
  clearSceneHistory,
  emitter,
  getSceneHistoryPauseDepth,
  initSpaceDetectionSync,
  LevelNode,
  pauseSceneHistory,
  resumeSceneHistory,
  useLiveNodeOverrides,
  useScene,
  WallNode,
} from '@pascal-app/core'
import { useEditor } from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { act, create } from '@react-three/test-renderer'
import { MoveWallTool } from './move-tool'

const LEVEL_ID = 'level_wall-move' as AnyNodeId
const DIVIDER_ID = 'wall_wall-move-divider' as AnyNodeId

// Two rooms split by a divider at x = 2; the gesture drags the divider to x = 2.5.
const walls = [
  WallNode.parse({ id: 'wall_wall-move-south', parentId: LEVEL_ID, start: [0, 0], end: [4, 0] }),
  WallNode.parse({ id: 'wall_wall-move-east', parentId: LEVEL_ID, start: [4, 0], end: [4, 4] }),
  WallNode.parse({ id: 'wall_wall-move-north', parentId: LEVEL_ID, start: [4, 4], end: [0, 4] }),
  WallNode.parse({ id: 'wall_wall-move-west', parentId: LEVEL_ID, start: [0, 4], end: [0, 0] }),
  WallNode.parse({ id: DIVIDER_ID, parentId: LEVEL_ID, start: [2, 0], end: [2, 4] }),
]

let stopDetection = () => {}
let reconcilePasses = 0
let savedWindow: PropertyDescriptor | undefined
let savedRaf: typeof requestAnimationFrame
let savedCancelRaf: typeof cancelAnimationFrame

function nodesOfType(type: AnyNode['type']) {
  return Object.values(useScene.getState().nodes).filter((node) => node.type === type)
}

function sceneNodes() {
  return structuredClone(useScene.getState().nodes)
}

beforeEach(() => {
  savedWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
  savedRaf = globalThis.requestAnimationFrame
  savedCancelRaf = globalThis.cancelAnimationFrame
  globalThis.window = new EventTarget() as Window & typeof globalThis
  globalThis.requestAnimationFrame = () => 0
  globalThis.cancelAnimationFrame = () => {}

  useScene.setState({
    nodes: { [LEVEL_ID]: LevelNode.parse({ id: LEVEL_ID, level: 0, height: 3, children: [] }) },
    rootNodeIds: [LEVEL_ID],
    dirtyNodes: new Set<AnyNodeId>(),
    collections: {},
    materials: {},
    readOnly: false,
  } as never)
  clearSceneHistory()
  useLiveNodeOverrides.getState().clearAll()
  stopDetection = initSpaceDetectionSync(useScene, useEditor, {
    onTopologyReconcile: () => {
      reconcilePasses += 1
    },
  })
  // Build the rooms through the live sync so the baseline already carries its derived
  // slabs, ceilings and wall sides: undo is then measured against a settled scene.
  useScene
    .getState()
    .applyNodeChanges({ create: walls.map((wall) => ({ node: wall, parentId: LEVEL_ID })) })
  clearSceneHistory()
  reconcilePasses = 0

  useEditor.setState({ mode: 'build', movingNodeOrigin: null, gridSnapStep: 0.5 } as never)
  useEditor.getState().setSnappingMode('wall', 'grid')
  useViewer.setState({
    selection: { buildingId: null, levelId: LEVEL_ID, zoneId: null, selectedIds: [DIVIDER_ID] },
  } as never)
})

afterEach(() => {
  stopDetection()
  useLiveNodeOverrides.getState().clearAll()
  clearSceneHistory()
  if (savedWindow) Object.defineProperty(globalThis, 'window', savedWindow)
  else Reflect.deleteProperty(globalThis, 'window')
  globalThis.requestAnimationFrame = savedRaf
  globalThis.cancelAnimationFrame = savedCancelRaf
})

async function armWall(id: AnyNodeId) {
  const wall = useScene.getState().nodes[id] as WallNode
  useEditor.getState().setMovingNode(wall)
  let renderer: Awaited<ReturnType<typeof create>> | null = null
  await act(async () => {
    renderer = await create(<MoveWallTool node={wall} />)
  })
  return renderer!
}

async function moveCursor(x: number) {
  await act(async () => {
    emitter.emit('grid:move', {
      position: [x, 0, 2],
      localPosition: [x, 0, 2],
      nativeEvent: {},
    } as never)
  })
}

async function dragFrom(from: number, to: number) {
  // The first sample anchors the drag; later samples carry the wall.
  await moveCursor(from)
  for (let index = 1; index <= 5; index += 1) await moveCursor(from + ((to - from) * index) / 5)
}

describe('3D wall move', () => {
  test('commits one undo step that restores the walls and every derived surface', async () => {
    expect(nodesOfType('slab')).toHaveLength(2)
    expect(nodesOfType('ceiling')).toHaveLength(2)
    const before = sceneNodes()
    const detect = spyOn(core, 'detectSpacesForLevel')

    const renderer = await armWall(DIVIDER_ID)
    await dragFrom(2, 2.5)
    const detectionsDuringDrag = detect.mock.calls.length
    detect.mockRestore()

    // The preview moves the room surfaces with their walls without writing the store.
    const slabPreviews = nodesOfType('slab').map(
      (slab) => useLiveNodeOverrides.getState().get(slab.id)?.polygon as [number, number][],
    )
    expect(slabPreviews.every(Array.isArray)).toBe(true)
    expect(slabPreviews.flat().some(([x]) => Math.abs(x - 2.5) < 1e-9)).toBe(true)
    expect(useScene.getState().nodes).toEqual(before)
    expect(useScene.temporal.getState().pastStates).toHaveLength(0)

    const commitDetect = spyOn(core, 'detectSpacesForLevel')
    reconcilePasses = 0
    await act(async () => {
      window.dispatchEvent(new Event('pointerup'))
    })
    await act(async () => renderer.unmount())
    // Rooms are detected once at commit: the live sync's indexed pass, nothing else.
    expect(commitDetect.mock.calls.length).toBe(0)
    commitDetect.mockRestore()
    expect(reconcilePasses).toBe(1)

    const moved = useScene.getState().nodes[DIVIDER_ID] as WallNode
    expect(moved.start).toEqual([2.5, 0])
    expect(moved.end).toEqual([2.5, 4])
    const committedSlabs = nodesOfType('slab') as Array<{ polygon: [number, number][] }>
    expect(committedSlabs.flatMap((slab) => slab.polygon).some(([x]) => x === 2.5)).toBe(true)
    expect(useLiveNodeOverrides.getState().overrides.size).toBe(0)
    expect(useScene.temporal.getState().pastStates).toHaveLength(1)
    expect(getSceneHistoryPauseDepth()).toBe(0)

    useScene.temporal.getState().undo()
    expect(useScene.getState().nodes).toEqual(before)

    useScene.temporal.getState().redo()
    expect((useScene.getState().nodes[DIVIDER_ID] as WallNode).start).toEqual([2.5, 0])
    expect(detectionsDuringDrag).toBe(0)
  })

  test('corner rooms follow a wall whose neighbours stretch with it', async () => {
    const east = 'wall_wall-move-east' as AnyNodeId
    const before = sceneNodes()
    const eastRoomSlab = nodesOfType('slab').find((slab) =>
      (slab as { polygon: [number, number][] }).polygon.some(([x]) => x === 4),
    )!

    const renderer = await armWall(east)
    await dragFrom(4, 4.5)
    const preview = useLiveNodeOverrides.getState().get(eastRoomSlab.id)?.polygon
    expect(preview).toEqual(
      expect.arrayContaining([
        [4.5, 0],
        [4.5, 4],
      ]),
    )

    await act(async () => {
      window.dispatchEvent(new Event('pointerup'))
    })
    await act(async () => renderer.unmount())

    const nodes = useScene.getState().nodes
    expect((nodes['wall_wall-move-south' as AnyNodeId] as WallNode).end).toEqual([4.5, 0])
    expect((nodes[eastRoomSlab.id] as { polygon: [number, number][] }).polygon).toEqual(
      expect.arrayContaining([
        [4.5, 0],
        [4.5, 4],
      ]),
    )
    expect(useScene.temporal.getState().pastStates).toHaveLength(1)

    useScene.temporal.getState().undo()
    expect(useScene.getState().nodes).toEqual(before)
  })

  test('split view: the 3D drop records one step while the 2D overlay co-owns the gesture', async () => {
    const before = sceneNodes()
    // FloorplanRegistryMoveOverlay holds a pause session keyed by the moving node.
    const overlay = beginSceneHistoryPauseSession(useScene, { gesture: DIVIDER_ID })
    const renderer = await armWall(DIVIDER_ID)
    await dragFrom(2, 2.5)
    await act(async () => {
      window.dispatchEvent(new Event('pointerup'))
    })
    await act(async () => renderer.unmount())
    overlay.end()

    expect((useScene.getState().nodes[DIVIDER_ID] as WallNode).start).toEqual([2.5, 0])
    expect(useScene.temporal.getState().pastStates).toHaveLength(1)
    expect(getSceneHistoryPauseDepth()).toBe(0)
    useScene.temporal.getState().undo()
    expect(useScene.getState().nodes).toEqual(before)
  })

  test('split view: a 2D drop records one step while the 3D tool co-owns the gesture', async () => {
    const renderer = await armWall(DIVIDER_ID)
    await dragFrom(2, 2.5)
    const overlay = beginSceneHistoryPauseSession(useScene, { gesture: DIVIDER_ID })
    overlay.commitStep(() =>
      useScene
        .getState()
        .updateNodes([
          { id: DIVIDER_ID, data: { start: [3, 0], end: [3, 4] } as Partial<AnyNode> },
        ]),
    )
    overlay.end()
    useEditor.getState().setMovingNodeOrigin('2d')
    await act(async () => renderer.unmount())

    expect((useScene.getState().nodes[DIVIDER_ID] as WallNode).start).toEqual([3, 0])
    expect(useScene.temporal.getState().pastStates).toHaveLength(1)
    expect(getSceneHistoryPauseDepth()).toBe(0)
  })

  test('cancel adds no history, restores the preview and keeps a foreign pause', async () => {
    const before = sceneNodes()
    pauseSceneHistory(useScene)
    try {
      const renderer = await armWall(DIVIDER_ID)
      await dragFrom(2, 2.5)
      await act(async () => {
        emitter.emit('tool:cancel')
      })
      await act(async () => renderer.unmount())

      expect(useScene.getState().nodes).toEqual(before)
      expect(useLiveNodeOverrides.getState().overrides.size).toBe(0)
      expect(useScene.temporal.getState().pastStates).toHaveLength(0)
      // The tool released only its own pause.
      expect(getSceneHistoryPauseDepth()).toBe(1)
      expect(useScene.temporal.getState().isTracking).toBe(false)
    } finally {
      resumeSceneHistory(useScene)
    }
    expect(getSceneHistoryPauseDepth()).toBe(0)
  })
})

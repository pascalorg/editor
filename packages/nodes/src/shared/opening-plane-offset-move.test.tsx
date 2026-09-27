import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  type AnyNode,
  type AnyNodeId,
  BuildingNode,
  DoorNode,
  emitter,
  LevelNode,
  sceneRegistry,
  spatialGridManager,
  useLiveNodeOverrides,
  useLiveTransforms,
  useScene,
  WallNode,
  WindowNode,
} from '@pascal-app/core'
import { useEditor } from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { act, create } from '@react-three/test-renderer'
import { Group } from 'three'
import { RegistryToolProvider } from '../../../editor/src/components/tools/registry-tool-context'
import { doorFloorplanMoveTarget } from '../door/floorplan-move'
import MoveDoorTool from '../door/move-tool'
import { windowFloorplanMoveTarget } from '../window/floorplan-move'
import MoveWindowTool from '../window/move-tool'

// A photo-profiled opening can stand proud of its wall: `position[2]` is its
// wall-local plane offset (the /next great-room slider sits at z = -0.205,
// frame wholly outside the 0.2032 m wall). Moving it ALONG that wall must keep
// the offset; moving it to ANOTHER wall resets it to the centre plane, because
// the offset belongs to the original wall's face.

const LEVEL_ID = 'level_plane-offset' as AnyNodeId
const WALL_A_ID = 'wall_plane-offset-own' as AnyNodeId
const WALL_B_ID = 'wall_plane-offset-other' as AnyNodeId
const OPENING_ID_DOOR = 'door_plane-offset' as AnyNodeId
const OPENING_ID_WINDOW = 'window_plane-offset' as AnyNodeId
const OFFSET = -0.205

let savedWindow: PropertyDescriptor | undefined
let savedDocument: typeof document
let savedRaf: typeof requestAnimationFrame
let savedCancelRaf: typeof cancelAnimationFrame
let savedScene: ReturnType<typeof useScene.getState>
let savedEditor: ReturnType<typeof useEditor.getState>
let savedViewer: ReturnType<typeof useViewer.getState>

function opening(kind: 'door' | 'window'): DoorNode | WindowNode {
  return kind === 'door'
    ? DoorNode.parse({
        id: OPENING_ID_DOOR,
        parentId: WALL_A_ID,
        wallId: WALL_A_ID,
        position: [2, 1.05, OFFSET],
        width: 1.2,
        height: 2.1,
        frameDepth: 0.2068,
      })
    : WindowNode.parse({
        id: OPENING_ID_WINDOW,
        parentId: WALL_A_ID,
        wallId: WALL_A_ID,
        position: [2, 1.5, OFFSET],
        width: 1.2,
        height: 1.2,
        frameDepth: 0.2068,
      })
}

function seedScene(kind: 'door' | 'window'): DoorNode | WindowNode {
  const node = opening(kind)
  const wallA = WallNode.parse({
    id: WALL_A_ID,
    parentId: LEVEL_ID,
    start: [0, 0],
    end: [6, 0],
    thickness: 0.2032,
    height: 3,
    children: [node.id],
  })
  const wallB = WallNode.parse({
    id: WALL_B_ID,
    parentId: LEVEL_ID,
    start: [0, 4],
    end: [6, 4],
    thickness: 0.2032,
    height: 3,
    children: [],
  })
  const level = LevelNode.parse({ id: LEVEL_ID, children: [WALL_A_ID, WALL_B_ID], level: 0 })
  const building = BuildingNode.parse({ id: 'building_plane-offset', children: [LEVEL_ID] })
  useScene.setState({
    nodes: {
      [building.id]: building,
      [LEVEL_ID]: { ...level, parentId: building.id },
      [WALL_A_ID]: wallA,
      [WALL_B_ID]: wallB,
      [node.id]: node,
    },
    rootNodeIds: [building.id],
    dirtyNodes: new Set<AnyNodeId>(),
    readOnly: false,
  } as never)
  return node
}

function current(id: AnyNodeId): AnyNode {
  const found = useScene.getState().nodes[id]
  if (!found) throw new Error(`missing ${id}`)
  return found
}

beforeEach(() => {
  savedScene = useScene.getState()
  savedEditor = useEditor.getState()
  savedViewer = useViewer.getState()
  savedWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
  savedDocument = globalThis.document
  savedRaf = globalThis.requestAnimationFrame
  savedCancelRaf = globalThis.cancelAnimationFrame
  globalThis.window = new EventTarget() as Window & typeof globalThis
  globalThis.document = { body: { style: { cursor: '' } } } as Document
  globalThis.requestAnimationFrame = (cb: FrameRequestCallback) => {
    cb(0)
    return 0
  }
  globalThis.cancelAnimationFrame = () => {}
  spatialGridManager.clear()
  useLiveNodeOverrides.getState().clearAll()
  useLiveTransforms.getState().clearAll()
  useEditor.setState({ mode: 'build', placementDragMode: false })
  useEditor.getState().setSnappingMode('item', 'off')
  useViewer.setState({
    selection: { buildingId: null, levelId: LEVEL_ID, zoneId: null, selectedIds: [] },
  })
  sceneRegistry.nodes.set(LEVEL_ID, new Group())
})

afterEach(() => {
  sceneRegistry.nodes.clear()
  spatialGridManager.clear()
  useLiveNodeOverrides.getState().clearAll()
  useLiveTransforms.getState().clearAll()
  useScene.setState(savedScene)
  useEditor.setState(savedEditor)
  useViewer.setState(savedViewer)
  if (savedWindow) Object.defineProperty(globalThis, 'window', savedWindow)
  else Reflect.deleteProperty(globalThis, 'window')
  globalThis.document = savedDocument
  globalThis.requestAnimationFrame = savedRaf
  globalThis.cancelAnimationFrame = savedCancelRaf
})

function wallEvent(wallId: AnyNodeId, localX: number, localY: number) {
  return {
    node: current(wallId),
    normal: [0, 0, 1],
    localPosition: [localX, localY, 0.1],
    position: [localX, localY, 0.1],
    nativeEvent: { timeStamp: localX },
    stopPropagation() {},
  } as never
}

async function drag3d(kind: 'door' | 'window', wallId: AnyNodeId, toLocalX: number) {
  const node = seedScene(kind)
  const y = node.position[1]
  const Tool = kind === 'door' ? MoveDoorTool : MoveWindowTool
  const renderer = await create(
    <RegistryToolProvider
      value={{
        activeLevelId: LEVEL_ID as LevelNode['id'],
        isCameraDragging: () => false,
        sceneApi: undefined as never,
        selectNode: () => {},
        unit: 'metric',
      }}
    >
      <Tool node={node as never} />
    </RegistryToolProvider>,
  )
  await act(async () => {
    // Grab on the own wall at the opening, then slide (or hop) and drop.
    emitter.emit('wall:enter', wallEvent(WALL_A_ID, node.position[0], y))
    emitter.emit('wall:move', wallEvent(wallId, toLocalX, y))
    emitter.emit('wall:click', wallEvent(wallId, toLocalX, y))
  })
  await act(async () => renderer.unmount())
  return current(node.id) as DoorNode | WindowNode
}

function drag2d(kind: 'door' | 'window', planPoint: [number, number]) {
  const node = seedScene(kind)
  const nodes = useScene.getState().nodes
  const session =
    kind === 'door'
      ? doorFloorplanMoveTarget({ node: node as DoorNode, nodes })
      : windowFloorplanMoveTarget({ node: node as WindowNode, nodes })
  session.apply({
    planPoint,
    modifiers: { shiftKey: false, altKey: false, ctrlKey: false, metaKey: false },
  })
  expect(session.canCommit()).toBe(true)
  session.commit()
  return current(node.id) as DoorNode | WindowNode
}

describe('opening move keeps the wall-local plane offset on its own wall', () => {
  for (const kind of ['door', 'window'] as const) {
    test(`3D ${kind} slid along its own wall keeps position[2]`, async () => {
      const moved = await drag3d(kind, WALL_A_ID, 3.5)
      expect(moved.wallId).toBe(WALL_A_ID)
      expect(moved.position[0]).not.toBeCloseTo(2, 3)
      expect(moved.position[2]).toBeCloseTo(OFFSET, 6)
    })

    test(`3D ${kind} moved to another wall resets position[2] to 0`, async () => {
      const moved = await drag3d(kind, WALL_B_ID, 3.5)
      expect(moved.wallId).toBe(WALL_B_ID)
      expect(moved.position[2]).toBe(0)
    })

    test(`2D ${kind} slid along its own wall keeps position[2]`, () => {
      const moved = drag2d(kind, [4, 0.05])
      expect(moved.wallId).toBe(WALL_A_ID)
      expect(moved.position[0]).toBeCloseTo(4, 6)
      expect(moved.position[2]).toBeCloseTo(OFFSET, 6)
    })

    test(`2D ${kind} moved to another wall resets position[2] to 0`, () => {
      const moved = drag2d(kind, [4, 3.95])
      expect(moved.wallId).toBe(WALL_B_ID)
      expect(moved.position[2]).toBe(0)
    })
  }
})

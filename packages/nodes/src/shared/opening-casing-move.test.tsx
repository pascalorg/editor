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
import { movedOpeningCasingFaces } from './opening-casing-move'

// Casing is kept per host face (`a` / `b`), and walls name their faces by the way they were
// drawn. Two outside walls of one box, both drawn left to right: wall A's `a` looks in, wall B's
// `a` looks out. An opening with its inside casing turned off on A must still have it off inside
// once moved to B, which there is its `b`.

const LEVEL_ID = 'level_casing-move' as AnyNodeId
const WALL_A_ID = 'wall_casing-move-a' as AnyNodeId
const WALL_B_ID = 'wall_casing-move-b' as AnyNodeId
const OPENING_ID = { door: 'door_casing-move', window: 'window_casing-move' } as const
// Inside off, outside on: on wall A, whose `a` looks in.
const ON_A = { casingFaceA: false, casingFaceB: true }

let savedWindow: PropertyDescriptor | undefined
let savedDocument: typeof document
let savedRaf: typeof requestAnimationFrame
let savedCancelRaf: typeof cancelAnimationFrame
let savedScene: ReturnType<typeof useScene.getState>
let savedEditor: ReturnType<typeof useEditor.getState>
let savedViewer: ReturnType<typeof useViewer.getState>

/** Walls A and B, both drawn left to right, with what each face (`a`, `b`) looks onto. */
function walls(sides: { a: WallNode['frontSide']; b: WallNode['backSide'] }[]) {
  return [
    { id: WALL_A_ID, start: [0, 0], end: [6, 0] },
    { id: WALL_B_ID, start: [0, 4], end: [6, 4] },
  ].map((wall, index) =>
    WallNode.parse({
      ...wall,
      parentId: LEVEL_ID,
      thickness: 0.2,
      height: 3,
      frontSide: sides[index]!.a,
      backSide: sides[index]!.b,
      children: [],
    }),
  )
}

const OUTSIDE_WALLS = walls([
  { a: 'interior', b: 'exterior' },
  { a: 'exterior', b: 'interior' },
])

function opening(kind: 'door' | 'window'): DoorNode | WindowNode {
  const shared = { id: OPENING_ID[kind], parentId: WALL_A_ID, wallId: WALL_A_ID, width: 1.2 }
  return kind === 'door'
    ? DoorNode.parse({ ...shared, ...ON_A, position: [2, 1.05, 0], height: 2.1 })
    : WindowNode.parse({ ...shared, ...ON_A, position: [2, 1.5, 0], height: 1.2 })
}

function seedScene(kind: 'door' | 'window'): DoorNode | WindowNode {
  const node = opening(kind)
  const [wallA, wallB] = OUTSIDE_WALLS as [WallNode, WallNode]
  const level = LevelNode.parse({ id: LEVEL_ID, children: [WALL_A_ID, WALL_B_ID], level: 0 })
  const building = BuildingNode.parse({ id: 'building_casing-move', children: [LEVEL_ID] })
  useScene.setState({
    nodes: {
      [building.id]: building,
      [LEVEL_ID]: { ...level, parentId: building.id },
      [WALL_A_ID]: { ...wallA, children: [node.id] },
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

const casingOf = (node: Pick<DoorNode, 'casingFaceA' | 'casingFaceB'>) => ({
  casingFaceA: node.casingFaceA,
  casingFaceB: node.casingFaceB,
})

describe('movedOpeningCasingFaces', () => {
  const sceneOf = (hosts: AnyNode[]) =>
    Object.fromEntries(hosts.map((host) => [host.id, host])) as Record<string, AnyNode>
  const onA = (rotation = 0) => ({
    parentId: WALL_A_ID,
    rotation: [0, rotation, 0] as [number, number, number],
    ...ON_A,
  })

  test('outside walls: each face goes to the face on its side, outside or in', () => {
    const nodes = sceneOf(OUTSIDE_WALLS)
    expect(movedOpeningCasingFaces(onA(), WALL_B_ID, [0, 0, 0], nodes)).toEqual({
      casingFaceA: true,
      casingFaceB: false,
    })
    // Whichever way the unit is turned on its new wall.
    expect(movedOpeningCasingFaces(onA(), WALL_B_ID, [0, Math.PI, 0], nodes)).toEqual({
      casingFaceA: true,
      casingFaceB: false,
    })
    const alike = sceneOf(
      walls([
        { a: 'interior', b: 'exterior' },
        { a: 'interior', b: 'exterior' },
      ]),
    )
    expect(movedOpeningCasingFaces(onA(), WALL_B_ID, [0, 0, 0], alike)).toEqual(ON_A)
  })

  test('walls that do not know their outside: the faces follow the way the unit faces', () => {
    const nodes = sceneOf(
      walls([
        { a: 'interior', b: 'interior' },
        { a: 'unknown', b: 'unknown' },
      ]),
    )
    expect(movedOpeningCasingFaces(onA(), WALL_B_ID, [0, 0, 0], nodes)).toEqual(ON_A)
    expect(movedOpeningCasingFaces(onA(), WALL_B_ID, [0, Math.PI, 0], nodes)).toEqual({
      casingFaceA: true,
      casingFaceB: false,
    })
    expect(movedOpeningCasingFaces(onA(Math.PI), WALL_B_ID, [0, Math.PI, 0], nodes)).toEqual(ON_A)
  })

  test("a roof face's `a` is its outside", () => {
    const roofFace = { id: 'rseg_casing-move', type: 'roof-segment' } as unknown as AnyNode
    const nodes = sceneOf([...OUTSIDE_WALLS, roofFace])
    // Wall A's outside is its `b`: on the gable it is the `a`.
    expect(movedOpeningCasingFaces(onA(), roofFace.id, [0, 0, 0], nodes)).toEqual({
      casingFaceA: true,
      casingFaceB: false,
    })
  })

  test('a slide along its own wall, or a host without cased faces, keeps them as they are', () => {
    const nodes = sceneOf(OUTSIDE_WALLS)
    expect(movedOpeningCasingFaces(onA(), WALL_A_ID, [0, Math.PI, 0], nodes)).toEqual(ON_A)
    expect(movedOpeningCasingFaces(onA(), LEVEL_ID, [0, Math.PI, 0], nodes)).toEqual(ON_A)
    const fromLevel = { ...onA(), parentId: LEVEL_ID }
    expect(movedOpeningCasingFaces(fromLevel, WALL_B_ID, [0, Math.PI, 0], nodes)).toEqual(ON_A)
  })
})

describe('a moved opening keeps its casing on its side of the wall', () => {
  for (const kind of ['door', 'window'] as const) {
    test(`3D ${kind} moved to a wall drawn the other way swaps its casing faces`, async () => {
      const moved = await drag3d(kind, WALL_B_ID, 3.5)
      expect(moved.wallId).toBe(WALL_B_ID)
      expect(casingOf(moved)).toEqual({ casingFaceA: true, casingFaceB: false })
    })

    test(`3D ${kind} slid along its own wall keeps its casing faces`, async () => {
      const moved = await drag3d(kind, WALL_A_ID, 3.5)
      expect(moved.wallId).toBe(WALL_A_ID)
      expect(casingOf(moved)).toEqual(ON_A)
    })

    test(`2D ${kind} moved to a wall drawn the other way swaps its casing faces`, () => {
      const moved = drag2d(kind, [4, 3.95])
      expect(moved.wallId).toBe(WALL_B_ID)
      expect(casingOf(moved)).toEqual({ casingFaceA: true, casingFaceB: false })
    })

    test(`2D ${kind} slid along its own wall keeps its casing faces`, () => {
      const moved = drag2d(kind, [4, 0.05])
      expect(moved.wallId).toBe(WALL_A_ID)
      expect(casingOf(moved)).toEqual(ON_A)
    })
  }
})

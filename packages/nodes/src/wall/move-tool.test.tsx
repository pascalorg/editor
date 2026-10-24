import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test'
import * as core from '@pascal-app/core'
import {
  type AnyNode,
  type AnyNodeId,
  clearSceneHistory,
  emitter,
  GROUND_SUPPORT_ID,
  getSceneHistoryPauseDepth,
  initSpaceDetectionSync,
  LevelNode,
  nodeRegistry,
  pauseSceneHistory,
  registerNode,
  resumeSceneHistory,
  sceneHistoryDraftRevertUpdates,
  useLiveNodeOverrides,
  useScene,
  WallNode,
} from '@pascal-app/core'
import { useEditor } from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { act, create } from '@react-three/test-renderer'
import { FloorplanRegistryMoveOverlay } from '../../../editor/src/components/editor-2d/floorplan-registry-move-overlay'
import { wallDefinition } from './definition'
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

afterEach(async () => {
  // A failed split-view case must not leave its tools (and their history state) mounted.
  const leftover = splitRenderer
  splitRenderer = null
  if (leftover) {
    try {
      await act(async () => leftover.unmount())
    } catch {
      // Already unmounted by the case itself.
    }
  }
  restoreDocument()
  restoreDocument = () => {}
  stopDetection()
  useLiveNodeOverrides.getState().clearAll()
  clearSceneHistory()
  await new Promise((resolve) => setTimeout(resolve, 0))
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

// The floor-plan pane for the real 2D move overlay: client coordinates are plan meters.
function stubFloorplanScene() {
  const svg = {
    createSVGPoint: () => {
      const point = { x: 0, y: 0, matrixTransform: () => ({ x: point.x, y: point.y }) }
      return point
    },
    getBoundingClientRect: () => ({ left: -100, right: 100, top: -100, bottom: 100 }),
  }
  const scene = {
    ownerSVGElement: svg,
    getScreenCTM: () => ({ inverse: () => ({}) }),
    appendChild: () => {},
    querySelector: () => null,
  }
  const saved = Object.getOwnPropertyDescriptor(globalThis, 'document')
  globalThis.document = {
    querySelector: (selector: string) => (selector === '[data-floorplan-scene]' ? scene : null),
    body: { style: { cursor: '' } },
  } as unknown as Document
  return () => {
    if (saved) Object.defineProperty(globalThis, 'document', saved)
    else Reflect.deleteProperty(globalThis, 'document')
  }
}

let restoreDocument = () => {}
let splitRenderer: Awaited<ReturnType<typeof create>> | null = null

// Split view: the 3D tool and the real FloorplanRegistryMoveOverlay, both on the moving wall.
async function armSplitView(id: AnyNodeId = DIVIDER_ID) {
  if (!nodeRegistry.get('wall')) registerNode(wallDefinition)
  restoreDocument = stubFloorplanScene()
  const wall = useScene.getState().nodes[id] as WallNode
  useEditor.getState().setMovingNode(wall)
  let renderer: Awaited<ReturnType<typeof create>> | null = null
  await act(async () => {
    renderer = await create(
      <>
        <FloorplanRegistryMoveOverlay />
        <MoveWallTool node={wall} />
      </>,
    )
  })
  splitRenderer = renderer
  return renderer!
}

async function floorplanPointer(type: 'pointermove' | 'pointerup', x: number, z: number) {
  await act(async () => {
    window.dispatchEvent(
      Object.assign(new Event(type), {
        button: 0,
        clientX: x,
        clientY: z,
        shiftKey: false,
        altKey: false,
        ctrlKey: false,
        metaKey: false,
      }),
    )
  })
}

function polygonArea(polygon: Array<[number, number]>) {
  let sum = 0
  for (let index = 0; index < polygon.length; index += 1) {
    const [x1, y1] = polygon[index]!
    const [x2, y2] = polygon[(index + 1) % polygon.length]!
    sum += x1 * y2 - x2 * y1
  }
  return Math.abs(sum) / 2
}

// Room-first model: each room is a zone (with its ceiling); the level's floor is one
// derived plate, so room counts and room previews read zones, not slabs.

/** Room area the viewer shows: each zone's live preview polygon, else its stored one. */
function effectiveRoomArea() {
  return nodesOfType('zone').reduce((total, zone) => {
    const preview = useLiveNodeOverrides.getState().get(zone.id)?.polygon
    return (
      total +
      polygonArea(
        (preview ?? (zone as { polygon: [number, number][] }).polygon) as Array<[number, number]>,
      )
    )
  }, 0)
}

/** A polygon without its collinear vertices, from its lowest-left vertex, counter-clockwise. */
function normalizedPolygon(polygon: Array<[number, number]>) {
  const round = ([x, y]: [number, number]): [number, number] => [
    Math.round(x * 1e6) / 1e6,
    Math.round(y * 1e6) / 1e6,
  ]
  let points = polygon.map(round)
  points = points.filter((point, index) => {
    const previous = points[(index + points.length - 1) % points.length]!
    const next = points[(index + 1) % points.length]!
    const cross =
      (point[0] - previous[0]) * (next[1] - point[1]) -
      (point[1] - previous[1]) * (next[0] - point[0])
    return Math.abs(cross) > 1e-9
  })
  let signed = 0
  for (let index = 0; index < points.length; index += 1) {
    const [x1, y1] = points[index]!
    const [x2, y2] = points[(index + 1) % points.length]!
    signed += x1 * y2 - x2 * y1
  }
  if (signed < 0) points.reverse()
  const start = points.reduce(
    (best, point, index) =>
      point[0] < points[best]![0] || (point[0] === points[best]![0] && point[1] < points[best]![1])
        ? index
        : best,
    0,
  )
  return [...points.slice(start), ...points.slice(0, start)]
}

describe('3D wall move', () => {
  test('a wall detached mid-drag loses its old preview even at the same snapped cursor', async () => {
    const east = 'wall_wall-move-east' as AnyNodeId
    const north = 'wall_wall-move-north' as AnyNodeId
    const renderer = await armWall(east)
    try {
      await dragFrom(4, 4.5)
      expect(useLiveNodeOverrides.getState().get(north)).toBeDefined()
      useScene.getState().updateNode(north, { start: [6, 6], end: [0, 6] })
      await moveCursor(4.5)
      expect(useLiveNodeOverrides.getState().get(north)).toBeUndefined()
      expect(useScene.getState().nodes[north]).toMatchObject({ start: [6, 6], end: [0, 6] })
    } finally {
      await act(async () => renderer.unmount())
    }
  })

  test.each([0, 4])('a room merge leaves no wall supported by a deleted slab (x=%s)', async (x) => {
    const slabs = nodesOfType('slab')
    useScene.getState().updateNode(DIVIDER_ID, { supportSlabId: slabs[0]!.id } as Partial<AnyNode>)
    clearSceneHistory()
    const renderer = await armWall(DIVIDER_ID)
    try {
      await dragFrom(2, x)
      await act(async () => {
        window.dispatchEvent(new Event('pointerup'))
      })
      const nodes = useScene.getState().nodes
      for (const wall of nodesOfType('wall') as WallNode[]) {
        if (wall.supportSlabId && wall.supportSlabId !== GROUND_SUPPORT_ID) {
          expect(nodes[wall.supportSlabId as AnyNodeId]?.type).toBe('slab')
        }
      }
      expect(useScene.temporal.getState().pastStates).toHaveLength(1)
    } finally {
      await act(async () => renderer.unmount())
    }
  })

  test('drop rejoins a moved endpoint within the connect radius in one reversible step', async () => {
    const target = WallNode.parse({
      id: 'wall_drop_target',
      parentId: LEVEL_ID,
      start: [2.53, -2],
      end: [2.53, 0.04],
    })
    useScene.getState().applyNodeChanges({
      create: [{ node: target, parentId: LEVEL_ID }],
      update: [{ id: DIVIDER_ID, data: { start: [2, 0.04] } }],
    })
    clearSceneHistory()
    const before = sceneNodes()
    const renderer = await armWall(DIVIDER_ID)
    await dragFrom(2, 2.5)
    await act(async () => {
      window.dispatchEvent(new Event('pointerup'))
    })
    await act(async () => renderer.unmount())
    expect(useScene.getState().nodes[DIVIDER_ID]).toMatchObject({
      start: [2.53, 0.04],
      end: [2.5, 4],
    })
    expect(nodesOfType('zone')).toHaveLength(2)
    expect(useScene.temporal.getState().pastStates).toHaveLength(1)
    useScene.temporal.getState().undo()
    expect(useScene.getState().nodes).toEqual(before)
  })

  test('commits one undo step that restores the walls and every derived surface', async () => {
    expect(nodesOfType('zone')).toHaveLength(2)
    expect(nodesOfType('ceiling')).toHaveLength(2)
    const before = sceneNodes()
    const detect = spyOn(core, 'detectSpacesForLevel')

    const renderer = await armWall(DIVIDER_ID)
    await dragFrom(2, 2.5)
    const detectionsDuringDrag = detect.mock.calls.length
    detect.mockRestore()

    // The preview moves the room surfaces with their walls without writing the store.
    const roomPreviews = nodesOfType('zone').map(
      (zone) => useLiveNodeOverrides.getState().get(zone.id)?.polygon as [number, number][],
    )
    expect(roomPreviews.every(Array.isArray)).toBe(true)
    expect(roomPreviews.flat().some(([x]) => Math.abs(x - 2.5) < 1e-9)).toBe(true)
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
    const committedRooms = nodesOfType('zone') as Array<{ polygon: [number, number][] }>
    expect(committedRooms.flatMap((zone) => zone.polygon).some(([x]) => x === 2.5)).toBe(true)
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
    const eastRoom = nodesOfType('zone').find((zone) =>
      (zone as { polygon: [number, number][] }).polygon.some(([x]) => x === 4),
    )!

    const renderer = await armWall(east)
    await dragFrom(4, 4.5)
    const preview = useLiveNodeOverrides.getState().get(eastRoom.id)?.polygon
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
    expect((nodes[eastRoom.id] as { polygon: [number, number][] }).polygon).toEqual(
      expect.arrayContaining([
        [4.5, 0],
        [4.5, 4],
      ]),
    )
    expect(useScene.temporal.getState().pastStates).toHaveLength(1)

    useScene.temporal.getState().undo()
    expect(useScene.getState().nodes).toEqual(before)
  })

  test('a support change joins the wall batch: one reconcile pass at commit', async () => {
    const [slab] = nodesOfType('slab')
    useScene
      .getState()
      .updateNodes([{ id: DIVIDER_ID, data: { supportSlabId: slab!.id } as Partial<AnyNode> }])
    clearSceneHistory()
    const renderer = await armWall(DIVIDER_ID)
    await dragFrom(2, 2.5)
    reconcilePasses = 0
    await act(async () => {
      window.dispatchEvent(new Event('pointerup'))
    })
    await act(async () => renderer.unmount())

    const divider = useScene.getState().nodes[DIVIDER_ID] as WallNode
    expect(divider.start).toEqual([2.5, 0])
    expect(divider.supportSlabId).not.toBe(slab!.id)
    expect(reconcilePasses).toBe(1)
    expect(useScene.temporal.getState().pastStates).toHaveLength(1)
  })

  test('a wall added mid-drag is its own reconciled step; one undo reverts only the drop', async () => {
    const renderer = await armWall(DIVIDER_ID)
    await moveCursor(2)
    await moveCursor(2.25)
    // A foreign write (a collaborator, an agent op) splits the east room while the drag runs.
    const foreignId = 'wall_wall-move-foreign' as AnyNodeId
    useScene
      .getState()
      .createNode(
        WallNode.parse({ id: foreignId, parentId: LEVEL_ID, start: [3, 0], end: [3, 4] }),
        LEVEL_ID,
      )
    expect(useScene.temporal.getState().pastStates).toHaveLength(1)
    expect(nodesOfType('zone')).toHaveLength(3)

    await moveCursor(2.5)
    // The preview follows the new rooms: the floors still tile the 4 × 4 box, no overlap.
    expect(effectiveRoomArea()).toBeCloseTo(16, 6)
    await act(async () => {
      window.dispatchEvent(new Event('pointerup'))
    })
    await act(async () => renderer.unmount())
    expect(useScene.temporal.getState().pastStates).toHaveLength(2)

    useScene.temporal.getState().undo()
    expect((useScene.getState().nodes[DIVIDER_ID] as WallNode).start).toEqual([2, 0])
    expect(useScene.getState().nodes[foreignId]).toBeDefined()
    expect(nodesOfType('zone')).toHaveLength(3)
  })

  test('a bridged junction previews the rooms the drop commits', async () => {
    // A diagonal boundary meets the east wall at (4, 0): moving the east wall bridges that
    // junction along the south wall instead of stretching the diagonal.
    const east = 'wall_wall-move-east' as AnyNodeId
    useScene.getState().applyNodeChanges({
      create: [
        {
          node: WallNode.parse({
            id: 'wall_wall-move-diagonal',
            parentId: LEVEL_ID,
            start: [2, 1],
            end: [4, 0],
          }),
          parentId: LEVEL_ID,
        },
      ],
    })
    clearSceneHistory()
    const renderer = await armWall(east)
    await dragFrom(4, 4.5)
    const previews = new Map(
      nodesOfType('zone').map((zone) => [
        zone.id,
        (useLiveNodeOverrides.getState().get(zone.id)?.polygon ??
          (zone as { polygon: [number, number][] }).polygon) as Array<[number, number]>,
      ]),
    )
    await act(async () => {
      window.dispatchEvent(new Event('pointerup'))
    })
    await act(async () => renderer.unmount())

    expect(useScene.getState().nodes[east] as WallNode).toMatchObject({ start: [4.5, 0] })
    const zones = nodesOfType('zone') as Array<{ id: AnyNodeId; polygon: [number, number][] }>
    expect(zones.some((zone) => zone.polygon.some(([x]) => x === 4.5))).toBe(true)
    for (const zone of zones) {
      expect(previews.has(zone.id)).toBe(true)
      expect(normalizedPolygon(previews.get(zone.id)!)).toEqual(normalizedPolygon(zone.polygon))
    }
  })

  test('a curved wall at a bridged junction previews the floor the drop commits', async () => {
    const east = 'wall_wall-move-east' as AnyNodeId
    useScene.getState().applyNodeChanges({
      update: [{ id: east, data: { curveOffset: 0.5 } as Partial<AnyNode> }],
      create: [
        {
          node: WallNode.parse({
            id: 'wall_wall-move-diagonal',
            parentId: LEVEL_ID,
            start: [2, 1],
            end: [4, 0],
          }),
          parentId: LEVEL_ID,
        },
      ],
    })
    clearSceneHistory()
    const renderer = await armWall(east)
    await dragFrom(4, 4.5)
    const previews = new Map(
      nodesOfType('slab').map((slab) => [
        slab.id,
        (useLiveNodeOverrides.getState().get(slab.id)?.polygon ??
          (slab as { polygon: [number, number][] }).polygon) as Array<[number, number]>,
      ]),
    )
    await act(async () => {
      window.dispatchEvent(new Event('pointerup'))
    })
    await act(async () => renderer.unmount())

    expect(useScene.getState().nodes[east] as WallNode).toMatchObject({ start: [4.5, 0] })
    for (const slab of nodesOfType('slab') as Array<{
      id: AnyNodeId
      polygon: [number, number][]
    }>) {
      expect(previews.has(slab.id)).toBe(true)
      expect(normalizedPolygon(previews.get(slab.id)!)).toEqual(normalizedPolygon(slab.polygon))
    }
  })

  test('after a drop that merges rooms, nothing deleted stays marked dirty', async () => {
    expect(nodesOfType('zone')).toHaveLength(2)
    const renderer = await armWall(DIVIDER_ID)
    await dragFrom(2, 0)
    await act(async () => {
      window.dispatchEvent(new Event('pointerup'))
    })
    await act(async () => renderer.unmount())

    const nodes = useScene.getState().nodes
    expect(nodesOfType('zone').length).toBeLessThan(2)
    expect([...useScene.getState().dirtyNodes].filter((id) => !nodes[id as AnyNodeId])).toEqual([])
  })

  test("a linked wall's endpoint changed mid-drag survives the drop", async () => {
    const east = 'wall_wall-move-east' as AnyNodeId
    const north = 'wall_wall-move-north' as AnyNodeId
    const renderer = await armWall(east)
    await moveCursor(4)
    await moveCursor(4.25)
    // An agent moves the north wall's free end (the east wall shares its other end).
    useScene.getState().updateNode(north, { end: [-1, 4] })
    await moveCursor(4.5)
    await act(async () => {
      window.dispatchEvent(new Event('pointerup'))
    })
    await act(async () => renderer.unmount())

    const nodes = useScene.getState().nodes
    expect((nodes[east] as WallNode).start).toEqual([4.5, 0])
    expect(nodes[north] as WallNode).toMatchObject({ start: [4.5, 4], end: [-1, 4] })
  })

  test('a wall connected mid-drag is planned with the move, and its far end kept', async () => {
    const east = 'wall_wall-move-east' as AnyNodeId
    const spur = 'wall_wall-move-spur' as AnyNodeId
    const renderer = await armWall(east)
    await moveCursor(4)
    await moveCursor(4.25)
    useScene
      .getState()
      .createNode(
        WallNode.parse({ id: spur, parentId: LEVEL_ID, start: [4, 4], end: [4, 6] }),
        LEVEL_ID,
      )
    await moveCursor(4.5)
    await act(async () => {
      window.dispatchEvent(new Event('pointerup'))
    })
    await act(async () => renderer.unmount())

    const nodes = useScene.getState().nodes
    const moved = nodes[east] as WallNode
    const connected = nodes[spur] as WallNode
    expect(moved.end).toEqual([4.5, 4])
    expect(connected.end).toEqual([4, 6])
    // The spur stays joined to the move: at the moved corner or through a bridge wall.
    const joined =
      JSON.stringify(connected.start) === JSON.stringify(moved.end) ||
      Object.values(nodes).some(
        (wall) =>
          wall.type === 'wall' &&
          [JSON.stringify((wall as WallNode).start), JSON.stringify((wall as WallNode).end)]
            .sort()
            .join() === [JSON.stringify(connected.start), JSON.stringify(moved.end)].sort().join(),
      )
    expect(joined).toBe(true)
  })

  test('split view: 2D preview then 3D drop retains linked wall history', async () => {
    const westId = 'wall_wall-move-west' as AnyNodeId
    const before = sceneNodes()
    const renderer = await armSplitView(westId)
    await floorplanPointer('pointermove', 0, 2)
    await floorplanPointer('pointermove', -1, 2)
    expect(useLiveNodeOverrides.getState().get('wall_wall-move-north' as AnyNodeId)?.end).toEqual([
      -1, 4,
    ])
    expect(useLiveNodeOverrides.getState().get('wall_wall-move-south' as AnyNodeId)?.start).toEqual(
      [-1, 0],
    )
    expect(sceneHistoryDraftRevertUpdates(Object.keys(before) as AnyNodeId[])).toEqual([])
    await dragFrom(0, -1)
    expect(useScene.temporal.getState().pastStates).toHaveLength(0)
    await act(async () => {
      window.dispatchEvent(new Event('pointerup'))
    })
    await act(async () => renderer.unmount())
    const after = sceneNodes()
    expect(after[westId]).toMatchObject({ start: [-1, 4], end: [-1, 0] })
    expect(after['wall_wall-move-north' as AnyNodeId]).toMatchObject({ end: [-1, 4] })
    expect(after['wall_wall-move-south' as AnyNodeId]).toMatchObject({ start: [-1, 0] })
    expect(useScene.temporal.getState().pastStates).toHaveLength(1)
    useScene.temporal.getState().undo()
    expect(useScene.getState().nodes).toEqual(before)
    useScene.temporal.getState().redo()
    expect(useScene.getState().nodes).toEqual(after)
  })

  test('split view: a 3D drop with the real 2D overlay mounted records one step', async () => {
    const before = sceneNodes()
    const renderer = await armSplitView()
    await dragFrom(2, 2.5)
    await act(async () => {
      // A 3D pointer-up: no floor-plan button, so the overlay leaves it to the 3D tool.
      window.dispatchEvent(new Event('pointerup'))
    })
    await act(async () => renderer.unmount())

    expect((useScene.getState().nodes[DIVIDER_ID] as WallNode).start).toEqual([2.5, 0])
    expect(useScene.temporal.getState().pastStates).toHaveLength(1)
    expect(getSceneHistoryPauseDepth()).toBe(0)
    expect(useScene.temporal.getState().isTracking).toBe(true)
    useScene.temporal.getState().undo()
    expect(useScene.getState().nodes).toEqual(before)
  })

  test('split view: a wall added mid-drag is its own reconciled step', async () => {
    const renderer = await armSplitView()
    await moveCursor(2)
    await moveCursor(2.5)
    const foreignId = 'wall_wall-move-foreign' as AnyNodeId
    useScene
      .getState()
      .createNode(
        WallNode.parse({ id: foreignId, parentId: LEVEL_ID, start: [3, 0], end: [3, 4] }),
        LEVEL_ID,
      )
    expect(useScene.temporal.getState().pastStates).toHaveLength(1)
    expect(nodesOfType('zone')).toHaveLength(3)
    await act(async () => {
      window.dispatchEvent(new Event('pointerup'))
    })
    await act(async () => renderer.unmount())
    expect(useScene.temporal.getState().pastStates).toHaveLength(2)
    expect(getSceneHistoryPauseDepth()).toBe(0)
    useScene.temporal.getState().undo()
    expect((useScene.getState().nodes[DIVIDER_ID] as WallNode).start).toEqual([2, 0])
    expect(useScene.getState().nodes[foreignId]).toBeDefined()
  })

  test('split view: a 2D-carried wall edit lets a foreign write record at once', async () => {
    const renderer = await armSplitView()
    await floorplanPointer('pointermove', 2, 2)
    await floorplanPointer('pointermove', 2.5, 2)
    const foreignId = 'wall_wall-move-foreign' as AnyNodeId
    useScene
      .getState()
      .createNode(
        WallNode.parse({ id: foreignId, parentId: LEVEL_ID, start: [3, 0], end: [3, 4] }),
        LEVEL_ID,
      )
    expect(useScene.temporal.getState().pastStates).toHaveLength(1)
    expect(nodesOfType('zone')).toHaveLength(3)
    await floorplanPointer('pointerup', 2.5, 2)
    await act(async () => renderer.unmount())
    expect(useScene.temporal.getState().pastStates).toHaveLength(2)
    expect(getSceneHistoryPauseDepth()).toBe(0)
  })

  test('split view: a 2D drop through the real overlay records one step', async () => {
    const before = sceneNodes()
    const renderer = await armSplitView()
    await floorplanPointer('pointermove', 2, 2)
    await floorplanPointer('pointermove', 3, 2)
    await floorplanPointer('pointerup', 3, 2)
    expect(useEditor.getState().movingNodeOrigin).toBe('2d')
    await act(async () => renderer.unmount())

    const divider = useScene.getState().nodes[DIVIDER_ID] as WallNode
    expect(divider.start).toEqual([3, 0])
    expect(divider.end).toEqual([3, 4])
    expect(useLiveNodeOverrides.getState().overrides.size).toBe(0)
    expect(useScene.temporal.getState().pastStates).toHaveLength(1)
    expect(getSceneHistoryPauseDepth()).toBe(0)
    expect(useScene.temporal.getState().isTracking).toBe(true)
    useScene.temporal.getState().undo()
    expect(useScene.getState().nodes).toEqual(before)
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

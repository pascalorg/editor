import { afterEach, expect, test } from 'bun:test'
import {
  type AnyNode,
  type AnyNodeId,
  BuildingNode,
  clearSceneHistory,
  createSceneApi,
  emitter,
  type GridEvent,
  LevelNode,
  RoofNode,
  type RoofSegmentNode,
  resolveRoomRoofFootprint,
  type SceneApi,
  useScene,
  WallNode,
  ZoneNode,
} from '@pascal-app/core'
import { RegistryToolProvider, sceneLayout, useEditor } from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { act, create } from '@react-three/test-renderer'
import { createElement } from 'react'
import { commitRoofFootprint, commitRoofPlacement, RoofTool } from './tool'

const originalDefaults = useEditor.getState().toolDefaults

afterEach(() => useEditor.setState({ toolDefaults: originalDefaults }))

function setup(thickness?: number) {
  const level = LevelNode.parse({ level: 0, height: 3 })
  const upper = LevelNode.parse({ level: 1, height: 3 })
  const polygon: Array<[number, number]> = [
    [0, 0],
    [4, 0],
    [4, 3],
    [0, 3],
  ]
  const walls = polygon.map((start, index) =>
    WallNode.parse({
      parentId: level.id,
      start,
      end: polygon[(index + 1) % polygon.length],
      height: 2.5,
      thickness,
    }),
  )
  level.children = walls.map((wall) => wall.id)
  const nodes = Object.fromEntries([level, upper, ...walls].map((node) => [node.id, node]))
  const created: Array<{ node: AnyNode; parentId?: AnyNodeId }> = []
  const updated: Array<{ id: AnyNodeId; data: Partial<AnyNode> }> = []
  const sceneApi = {
    nodes: () => nodes,
    createMany: (ops) => created.push(...ops),
    upsert: (node, parentId) => created.push({ node, parentId }),
    update: (id, data) => updated.push({ id, data }),
  } as SceneApi
  return { level, upper, nodes, created, updated, sceneApi }
}

test('room creation follows walls and retains the computed initial Y', () => {
  const { upper, nodes, created, sceneApi } = setup()
  useEditor.getState().setToolDefaults('roof', { roofType: 'gable', support: { kind: 'level' } })
  const target = resolveRoomRoofFootprint(upper.id, nodes, [2, 1])!
  commitRoofFootprint(sceneApi, upper.id, target, false)
  const roof = created.find(({ node }) => node.type === 'roof')!
  expect(roof.parentId).toBe(upper.id)
  expect(roof.node).toMatchObject({ support: { kind: 'walls' }, position: [2, -0.5, 1.5] })
})

test('free-drawn rectangles stay custom at Y zero even with following preset defaults', () => {
  const { upper, created, sceneApi } = setup()
  useEditor.getState().setToolDefaults('roof', { roofType: 'gable', support: { kind: 'walls' } })
  commitRoofPlacement(sceneApi, upper.id, [0, 9, 0], [4, 9, 3], [], false, 'ground')
  const roof = created.find(({ node }) => node.type === 'roof')?.node as RoofNode
  expect(roof).toMatchObject({ support: { kind: 'level' }, position: [2, 0, 1.5] })
})

test("room creation from the walls' own level still parents the roof to the level above", () => {
  const { upper, nodes, created, sceneApi } = setup()
  const level = Object.values(nodes).find((node) => node.type === 'level' && node.id !== upper.id)!
  const target = resolveRoomRoofFootprint(level.id as LevelNode['id'], nodes, [2, 1])!
  commitRoofFootprint(sceneApi, level.id as LevelNode['id'], target, false)
  const roof = created.find(({ node }) => node.type === 'roof')!
  expect(roof.parentId).toBe(upper.id)
  expect(roof.node).toMatchObject({ support: { kind: 'walls' }, position: [2, -0.5, 1.5] })
})

test('room creation on the top floor puts the roof on a new Roof level, on the wall tops', () => {
  const { upper, nodes, created, sceneApi } = setup()
  delete nodes[upper.id]
  const level = Object.values(nodes).find((node) => node.type === 'level')!
  const target = resolveRoomRoofFootprint(level.id as LevelNode['id'], nodes, [2, 1])!
  commitRoofFootprint(sceneApi, level.id as LevelNode['id'], target, false)
  const roofLevel = created.find(({ node }) => node.type === 'level')?.node as LevelNode
  const roof = created.find(({ node }) => node.type === 'roof')!
  expect(roofLevel).toMatchObject({ name: 'Roof', level: 1, metadata: { role: 'roof' } })
  expect(roof.parentId).toBe(roofLevel.id)
  // 2.5 m walls under a 3 m storey: the eave 0.5 m below the roof level's floor.
  expect(roof.node).toMatchObject({ support: { kind: 'walls' }, position: [2, -0.5, 1.5] })
})

// Lifted onto the roof level, a drawn rectangle stayed on that level's plane: walls taller or
// lower than their storey left it floating or buried, and it never followed their height.
test('a rectangle drawn on a walled storey goes on its roof level, standing on its walls', () => {
  const { level, upper, created, updated, sceneApi } = setup()
  commitRoofPlacement(sceneApi, level.id, [0, 0, 0], [4, 0, 3], [], false, 'ground')
  const roof = created.find(({ node }) => node.type === 'roof')!
  expect(roof.parentId).toBe(upper.id)
  // 2.5 m walls under a 3 m storey: the eave 0.5 m below the roof level's floor.
  expect(roof.node).toMatchObject({ support: { kind: 'walls' }, position: [2, -0.5, 1.5] })
  expect(updated).toEqual([{ id: upper.id, data: { metadata: { role: 'roof' }, name: 'Roof' } }])
})

// The owner's porch clause: a porch or portico on posts stays on its storey. Drawn by hand, any
// rectangle on a walled storey went to the roof level, a portico beside the house included.
test('a porch drawn against the house over posts stays on its storey', () => {
  const { level, nodes, created, updated, sceneApi } = setup()
  const room = ZoneNode.parse({
    parentId: level.id,
    name: 'Room',
    polygon: [
      [0, 0],
      [4, 0],
      [4, 3],
      [0, 3],
    ],
  })
  nodes[room.id] = room
  nodes[level.id] = { ...level, children: [...level.children, room.id] }
  commitRoofPlacement(sceneApi, level.id, [4, 0, 0.5], [6, 0, 2.5], [], false, 'ground')
  const roof = created.find(({ node }) => node.type === 'roof')!
  expect(roof.parentId).toBe(level.id)
  expect(roof.node).toMatchObject({ support: { kind: 'level' } })
  expect(updated).toEqual([])
})

// Standard trusses bear on the top plate: a raised heel is an explicit Wall Height, never a default.
test('a drawn roof bears on the top plate, and a raised heel stays a setting', () => {
  const { level, created, sceneApi } = setup()
  commitRoofPlacement(sceneApi, level.id, [0, 0, 0], [4, 0, 3], [], false, 'ground')
  const segment = created.find(({ node }) => node.type === 'roof-segment')?.node
  expect(segment).toMatchObject({ type: 'roof-segment', wallHeight: 0 })

  const raised = setup()
  useEditor.getState().setToolDefaults('roof', { roofType: 'gable', wallHeight: 0.45 })
  commitRoofPlacement(raised.sceneApi, raised.level.id, [0, 0, 0], [4, 0, 3], [], false, 'ground')
  const heeled = raised.created.find(({ node }) => node.type === 'roof-segment')?.node
  expect(heeled).toMatchObject({ type: 'roof-segment', wallHeight: 0.45 })
})

// A segment's ridge runs along its width (local x): a long-side ridge over a deep rectangle turns a quarter.
test('a drawn gable runs its ridge along the long side by default, and across it on request', () => {
  const ridgeOf = (corner2: [number, number, number], ridge: 'long' | 'short') => {
    const { level, created, sceneApi } = setup()
    commitRoofPlacement(sceneApi, level.id, [0, 0, 0], corner2, [], ridge, 'ground')
    return created.find(({ node }) => node.type === 'roof-segment')?.node
  }
  expect(ridgeOf([2, 0, 6], 'long')).toMatchObject({ width: 6, depth: 2, rotation: Math.PI / 2 })
  expect(ridgeOf([6, 0, 2], 'long')).toMatchObject({ width: 6, depth: 2, rotation: 0 })
  expect(ridgeOf([2, 0, 6], 'short')).toMatchObject({ width: 2, depth: 6, rotation: 0 })
})

const segmentOf = (created: Array<{ node: AnyNode }>) =>
  created.find(({ node }) => node.type === 'roof-segment')?.node as RoofSegmentNode | undefined

// Gable and heel walls 0.1 m thick on 0.18 m walls stood a ledge proud of the walls below.
test('a roof drawn or made over walls gives its gable and heel walls their thickness', () => {
  const drawn = setup(0.18)
  commitRoofPlacement(drawn.sceneApi, drawn.level.id, [0, 0, 0], [4, 0, 3], [], false, 'ground')
  expect(segmentOf(drawn.created)?.wallThickness).toBeCloseTo(0.18)

  const room = setup(0.18)
  const target = resolveRoomRoofFootprint(room.level.id, room.nodes, [2, 1])!
  commitRoofFootprint(room.sceneApi, room.level.id, target, false)
  expect(segmentOf(room.created)?.wallThickness).toBeCloseTo(0.18)

  // Off the walls, a plane keeps the default.
  const porch = setup(0.18)
  commitRoofPlacement(porch.sceneApi, porch.level.id, [5, 0, 0.5], [7, 0, 2.5], [], false, 'ground')
  expect(segmentOf(porch.created)?.wallThickness).toBeCloseTo(0.1)
})

test('a plane added to a selected roof over the walls takes their thickness', () => {
  const { upper, nodes, created, sceneApi } = setup(0.18)
  const roof = RoofNode.parse({ parentId: upper.id, position: [2, 0, 1.5], children: [] })
  const scene = nodes as Record<string, AnyNode>
  scene[roof.id] = roof
  scene[upper.id] = { ...upper, children: [roof.id] }
  commitRoofPlacement(sceneApi, upper.id, [0, 0, 0], [4, 0, 3], [roof.id], false, 'ground')
  const segment = segmentOf(created)
  expect(segment?.position).toEqual([0, 0, 0])
  expect(segment?.wallThickness).toBeCloseTo(0.18)
})

type RafFn = (cb: (time: number) => void) => number

// Hidden behind the canvas in 2D-only view, the 3D tool kept a first corner from before the view
// changed: back in split view, the next click made a roof from that corner.
test('a corner opened before the view went 2D-only does not end the next roof in split view', async () => {
  const globals = globalThis as unknown as {
    IS_REACT_ACT_ENVIRONMENT?: boolean
    requestAnimationFrame?: RafFn
    cancelAnimationFrame?: (id: number) => void
  }
  globals.IS_REACT_ACT_ENVIRONMENT = true
  globals.requestAnimationFrame ??= (cb) => {
    cb(0)
    return 0
  }
  globals.cancelAnimationFrame ??= () => {}
  const previous = { editor: useEditor.getState(), viewer: useViewer.getState() }
  const windowDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'window')
  globalThis.window = new EventTarget() as Window & typeof globalThis

  const { level, upper, nodes } = setup()
  delete nodes[upper.id]
  const building = BuildingNode.parse({ children: [level.id] })
  useScene.getState().setScene(
    {
      ...nodes,
      [building.id]: building,
      [level.id]: { ...level, parentId: building.id },
    } as Record<AnyNodeId, AnyNode>,
    [building.id as AnyNodeId],
    { installedPlugins: [], hasExplicitPluginInstallState: false },
  )
  clearSceneHistory()
  useViewer.getState().setSelection({ buildingId: building.id, levelId: level.id })
  // Over the plan, the cursor's DOM tooltip stays out of the canvas.
  useEditor.setState({ mode: 'build', tool: 'roof', isFloorplanHovered: true })
  const showViews = (scene: '2d' | 'split') =>
    act(async () => useEditor.setState({ viewLayouts: { edit: sceneLayout(scene) } }))
  const click = (x: number, z: number) =>
    act(async () => {
      const event = {
        position: [x, 0, z],
        localPosition: [x, 0, z],
        nativeEvent: {} as GridEvent['nativeEvent'],
      } satisfies GridEvent
      emitter.emit('grid:move', event)
      emitter.emit('grid:click', event)
    })
  const roofs = () => Object.values(useScene.getState().nodes).filter((n) => n.type === 'roof')

  await showViews('split')
  const renderer = await create(
    createElement(RegistryToolProvider, {
      value: {
        activeLevelId: level.id,
        isCameraDragging: () => false,
        sceneApi: createSceneApi(useScene),
        selectNode: (id) => useViewer.getState().setSelection({ selectedIds: [id] }),
        unit: 'metric',
      },
      children: createElement(RoofTool),
    }),
  )
  try {
    await click(0, 0)
    await showViews('2d')
    await showViews('split')
    await click(4, 3)
    expect(roofs()).toHaveLength(0)
    await click(8, 6)
    expect(roofs()).toHaveLength(1)
  } finally {
    await act(async () => renderer.unmount())
    useEditor.setState(previous.editor, true)
    useViewer.setState(previous.viewer, true)
    if (windowDescriptor) Object.defineProperty(globalThis, 'window', windowDescriptor)
    else Reflect.deleteProperty(globalThis, 'window')
  }
})

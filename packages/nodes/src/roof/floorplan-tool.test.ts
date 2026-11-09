import { afterEach, beforeEach, expect, test } from 'bun:test'
import {
  type AnyNode,
  type AnyNodeId,
  BuildingNode,
  clearSceneHistory,
  createSceneApi,
  emitter,
  type GridEvent,
  getLevelElevations,
  getWallCurveFrameAt,
  LevelNode,
  type RoofNode,
  type RoofSegmentNode,
  SeparatorNode,
  useScene,
  WallNode,
  ZoneNode,
} from '@pascal-app/core'
import {
  type FloorplanToolContext,
  sceneLayout,
  useEditor,
  useFloorplanDraftPreview,
} from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { act, create } from '@react-three/test-renderer'
import { createElement } from 'react'
import RoofFloorplanTool from './floorplan-tool'
import useRoofFootprintSource from './roof-footprint-source'
import { segmentWallLine } from './wall-catch'

type RafFn = (cb: (time: number) => void) => number
;(globalThis as unknown as { requestAnimationFrame?: RafFn }).requestAnimationFrame ??= (cb) => {
  cb(0)
  return 0
}
;(globalThis as unknown as { cancelAnimationFrame?: (id: number) => void }).cancelAnimationFrame ??=
  () => {}
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const previous = { editor: useEditor.getState(), viewer: useViewer.getState() }
const windowDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'window')

beforeEach(() => {
  globalThis.window = new EventTarget() as Window & typeof globalThis
})

afterEach(() => {
  useEditor.setState(previous.editor, true)
  useViewer.setState(previous.viewer, true)
  useRoofFootprintSource.setState({ source: 'draw', roomPick: null })
  if (windowDescriptor) Object.defineProperty(globalThis, 'window', windowDescriptor)
  else Reflect.deleteProperty(globalThis, 'window')
})

const RECTANGLE: Array<[number, number]> = [
  [0, 0],
  [4, 0],
  [4, 3],
  [0, 3],
]

function setScene(
  polygon: Array<[number, number]>,
  { upperLevel = true, rotation = 0 }: { upperLevel?: boolean; rotation?: number } = {},
) {
  const building = BuildingNode.parse({ rotation: [0, rotation, 0] })
  const level = LevelNode.parse({ parentId: building.id, level: 0, height: 3 })
  const upper = LevelNode.parse({ parentId: building.id, level: 1, height: 3 })
  building.children = upperLevel ? [level.id, upper.id] : [level.id]
  const walls = polygon.map((start, index) =>
    WallNode.parse({
      parentId: level.id,
      start,
      end: polygon[(index + 1) % polygon.length],
      height: 2.5,
    }),
  )
  level.children = walls.map((wall) => wall.id)
  const nodes = Object.fromEntries(
    [building, level, ...(upperLevel ? [upper] : []), ...walls].map((n) => [n.id, n]),
  )
  useScene.getState().setScene(nodes as Record<AnyNodeId, AnyNode>, [building.id as AnyNodeId], {
    installedPlugins: [],
    hasExplicitPluginInstallState: false,
  })
  clearSceneHistory()
  useViewer.getState().setSelection({ buildingId: building.id, levelId: level.id })
  useEditor.setState({ phase: 'structure', mode: 'build', tool: 'roof', workspaceMode: 'edit' })
  return { level, upper }
}

const roofs = () => Object.values(useScene.getState().nodes).filter((n) => n.type === 'roof')

const showViews = (scene: '2d' | 'split') =>
  act(async () => useEditor.setState({ viewLayouts: { edit: sceneLayout(scene) } }))

async function mountTool(levelId: LevelNode['id']) {
  const context: FloorplanToolContext = {
    sceneApi: createSceneApi(useScene),
    activeLevelId: levelId,
    unit: 'metric',
    metricNotation: 'meters',
    gridSnapStep: 0.5,
    toolDefaults: null,
    selectNode: (id) => useViewer.getState().setSelection({ selectedIds: [id] }),
    finishTool: () => {},
  }
  return create(createElement(RoofFloorplanTool, context))
}

const gridEvent = (x: number, z: number) =>
  ({
    position: [x, 0, z],
    localPosition: [x, 0, z],
    nativeEvent: {} as GridEvent['nativeEvent'],
  }) satisfies GridEvent

const move = (x: number, z: number) => act(async () => emitter.emit('grid:move', gridEvent(x, z)))

const click = (x: number, z: number) =>
  act(async () => {
    emitter.emit('grid:move', gridEvent(x, z))
    emitter.emit('grid:click', gridEvent(x, z))
  })

// The 3D roof tool lives in the canvas, which never renders while its pane is hidden: in 2D-only
// view a roof drawn on the plan was never written. In split view the 3D tool stays its one owner.
test('a roof drawn on the plan in 2D-only view is made; split view leaves it to the 3D tool', async () => {
  const { level } = setScene(RECTANGLE)
  await showViews('2d')
  const renderer = await mountTool(level.id)
  try {
    await click(0, 0)
    expect(roofs()).toHaveLength(0)
    await click(4, 3)
    expect(roofs()).toHaveLength(1)
    expect(useViewer.getState().selection.selectedIds).toEqual([roofs()[0]!.id])

    await act(async () => useViewer.getState().setSelection({ selectedIds: [] }))
    await showViews('split')
    await click(6, 0)
    await click(9, 3)
    expect(roofs()).toHaveLength(1)
  } finally {
    await act(async () => renderer.unmount())
  }
})

test('Room roofs the room clicked, and says why an L-shaped one makes nothing', async () => {
  await showViews('2d')
  useRoofFootprintSource.setState({ source: 'room' })
  const rectangle = await mountTool(setScene(RECTANGLE).level.id)
  try {
    await click(2, 1)
    expect(roofs()).toHaveLength(1)
    expect(useRoofFootprintSource.getState().roomPick).toBe('room')
    await click(9, 9)
    expect(useRoofFootprintSource.getState().roomPick).toBe('none')
  } finally {
    await act(async () => rectangle.unmount())
  }

  const ell = await mountTool(
    setScene([
      [0, 0],
      [6, 0],
      [6, 2],
      [2, 2],
      [2, 6],
      [0, 6],
    ]).level.id,
  )
  try {
    await click(1, 1)
    expect(roofs()).toHaveLength(0)
    expect(useRoofFootprintSource.getState().roomPick).toBe('irregular')
  } finally {
    await act(async () => ell.unmount())
  }
  expect(useRoofFootprintSource.getState().roomPick).toBeNull()
})

// Switching to 2D-only with a rectangle open in 3D left the plan's draft with a first corner this
// tool never had: every click then started one and ended the other, a roof each second click.
test('a rectangle left open by the 3D tool is dropped when the plan takes over', async () => {
  const { level } = setScene(RECTANGLE)
  await showViews('2d')
  useFloorplanDraftPreview.getState().setRoofDraftStart([1, 1])
  useFloorplanDraftPreview.getState().setRoofDraftEnd([2, 2])
  const renderer = await mountTool(level.id)
  try {
    expect(useFloorplanDraftPreview.getState().roofDraftStart).toBeNull()
    expect(useFloorplanDraftPreview.getState().roofDraftEnd).toBeNull()
  } finally {
    await act(async () => renderer.unmount())
  }
})

// Split view's 3D tool snaps the drafted corners onto the walls below; the plan tool took the
// plan's point as it came, so on the Roof level the same clicks made a roof a few cm off the house.
test('a roof drawn on the level over the walls snaps to their corners, as in split view', async () => {
  const { upper } = setScene(RECTANGLE)
  await showViews('2d')
  const renderer = await mountTool(upper.id)
  try {
    await click(0.03, 0.02)
    await click(3.97, 2.98)
    const roof = roofs()[0] as RoofNode
    expect(roof.position[0]).toBeCloseTo(2)
    expect(roof.position[2]).toBeCloseTo(1.5)
    const segment = useScene.getState().nodes[roof.children[0]!] as RoofSegmentNode
    expect([segment.width, segment.depth].sort()).toEqual([3, 4])
  } finally {
    await act(async () => renderer.unmount())
  }
})

// The plan drew its draft from its own grid point while the roof committed at the corner the tool
// snapped: the dashed rectangle must be the roof the next click makes.
test('the plan’s draft rectangle runs between the corners the roof commits at', async () => {
  const { upper } = setScene(RECTANGLE)
  await showViews('2d')
  const renderer = await mountTool(upper.id)
  const draft = () => {
    const { roofDraftStart, roofDraftEnd } = useFloorplanDraftPreview.getState()
    return { roofDraftStart, roofDraftEnd }
  }
  try {
    await click(0.03, 0.02)
    expect(draft()).toEqual({ roofDraftStart: [0, 0], roofDraftEnd: [0, 0] })
    await move(3.97, 2.98)
    expect(draft()).toEqual({ roofDraftStart: [0, 0], roofDraftEnd: [4, 3] })
    await click(3.97, 2.98)
    expect(roofs()[0]!.position[0]).toBeCloseTo(2)
    expect(draft()).toEqual({ roofDraftStart: null, roofDraftEnd: null })
  } finally {
    await act(async () => renderer.unmount())
  }
})

// The plan clears its draft when Room is picked, but the tool kept its first corner: back on Draw,
// the next click made a roof from a corner nothing showed.
test('a first corner is dropped when the footprint source changes', async () => {
  const { level } = setScene(RECTANGLE)
  await showViews('2d')
  const renderer = await mountTool(level.id)
  try {
    await click(0, 0)
    await act(async () => useRoofFootprintSource.setState({ source: 'room' }))
    await act(async () => useRoofFootprintSource.setState({ source: 'draw' }))
    await click(6, 5)
    expect(roofs()).toHaveLength(0)
    expect(useFloorplanDraftPreview.getState().roofDraftStart).toEqual([6, 5])
  } finally {
    await act(async () => renderer.unmount())
  }
})

// Reported on a turned building: the roof came out thin and the Roof level at grade. Drawn on the
// plan over the top storey's walls, it is the rectangle drawn, on a Roof level made at the
// storey's top, its eave on the wall tops.
test('on a turned building, a roof drawn over the top storey lands on a new Roof level', async () => {
  const { level } = setScene(RECTANGLE, { upperLevel: false, rotation: Math.PI / 5 })
  await showViews('2d')
  const renderer = await mountTool(level.id)
  try {
    await click(0, 0)
    await click(4, 3)
    const nodes = useScene.getState().nodes
    const roof = roofs()[0] as RoofNode
    const roofLevel = nodes[roof.parentId as AnyNodeId] as LevelNode
    expect(roofLevel).toMatchObject({ name: 'Roof', level: 1, metadata: { role: 'roof' } })
    expect(getLevelElevations(nodes).get(roofLevel.id)?.baseY).toBeCloseTo(3)
    // 2.5 m walls under a 3 m storey: the eave 0.5 m below the roof level's floor.
    expect(roof).toMatchObject({ support: { kind: 'walls' }, rotation: 0 })
    expect(roof.position[1]).toBeCloseTo(-0.5)
    const segment = nodes[roof.children[0]!] as RoofSegmentNode
    expect([segment.width, segment.depth].sort()).toEqual([3, 4])
  } finally {
    await act(async () => renderer.unmount())
  }
})

// A cone builds over a curved wall, and the plan raises no wall events for one: in a 2D-only
// session the clicks made nothing.
test('a cone is built over the curved wall clicked on the plan in 2D-only view', async () => {
  const { level } = setScene(RECTANGLE)
  const curved = WallNode.parse({
    parentId: level.id,
    start: [8, 0],
    end: [12, 0],
    curveOffset: 1,
    height: 2.5,
  })
  useScene.getState().createNode(curved, level.id)
  clearSceneHistory()
  useEditor.getState().setToolDefaults('roof', { roofType: 'conical' })
  await showViews('2d')
  const renderer = await mountTool(level.id)
  try {
    await click(2, 1)
    expect(roofs()).toHaveLength(0)

    const onArc = getWallCurveFrameAt(curved, 0.5).point
    await move(onArc.x, onArc.y + 0.1)
    expect(useViewer.getState().previewSelectedIds).toEqual([curved.id])
    await click(onArc.x, onArc.y + 0.1)
    expect(roofs().map((roof) => roof.metadata)).toEqual([
      expect.objectContaining({ conicalSourceWallId: curved.id }),
    ])
    expect(useViewer.getState().previewSelectedIds).toEqual([])
  } finally {
    await act(async () => renderer.unmount())
  }
})

const RAIL = 3.5 * 0.0254
const H = RAIL / 2

// A porch: a 10 x 8 m house of 0.2 m walls, a porch off its south wall (z 0)
// closed by invisible walls at x 2.2 and 7.8 and z -2.4, or a deck fenced there by railings.
function setPorchScene(open: 'separators' | 'railings') {
  const building = BuildingNode.parse({})
  const level = LevelNode.parse({ parentId: building.id, level: 0, height: 3 })
  const upper = LevelNode.parse({ parentId: building.id, level: 1, height: 3 })
  building.children = [level.id, upper.id]
  const corners: Array<[number, number]> = [
    [0, 0],
    [10, 0],
    [10, 8],
    [0, 8],
  ]
  const house = corners.map((start, index) =>
    WallNode.parse({
      parentId: level.id,
      start,
      end: corners[(index + 1) % 4],
      height: 2.5,
      thickness: 0.2,
    }),
  )
  const sides: Array<[[number, number], [number, number]]> = [
    [
      [2.2, 0],
      [2.2, -2.4],
    ],
    [
      [2.2, -2.4],
      [7.8, -2.4],
    ],
    [
      [7.8, -2.4],
      [7.8, 0],
    ],
  ]
  const edges = sides.map(([start, end]) =>
    open === 'separators'
      ? SeparatorNode.parse({ parentId: level.id, start, end })
      : WallNode.parse({
          parentId: level.id,
          start,
          end,
          wallType: 'railing',
          thickness: RAIL,
          height: 36 * 0.0254,
        }),
  )
  const rooms = [
    ZoneNode.parse({ parentId: level.id, name: 'Living', polygon: corners }),
    ZoneNode.parse({
      parentId: level.id,
      name: open === 'separators' ? 'Porch' : 'Deck',
      roomType: open === 'separators' ? 'porch' : 'deck',
      polygon: [
        [2.2, 0],
        [2.2, -2.4],
        [7.8, -2.4],
        [7.8, 0],
      ],
    }),
  ]
  level.children = [...house, ...edges, ...rooms].map((node) => node.id) as LevelNode['children']
  const nodes = Object.fromEntries(
    [building, level, upper, ...house, ...edges, ...rooms].map((node) => [node.id, node]),
  )
  useScene.getState().setScene(nodes as Record<AnyNodeId, AnyNode>, [building.id as AnyNodeId], {
    installedPlugins: [],
    hasExplicitPluginInstallState: false,
  })
  clearSceneHistory()
  useViewer.getState().setSelection({ buildingId: building.id, levelId: upper.id })
  useEditor.setState({
    phase: 'structure',
    mode: 'build',
    tool: 'roof',
    workspaceMode: 'edit',
    snappingModeByContext: { ...useEditor.getState().snappingModeByContext, polygon: 'lines' },
  })
  return { level, upper, edges }
}

/** A roof's one segment's wall line in the plan: its x and z extents. */
function wallLineExtents(roof: RoofNode) {
  const segment = useScene.getState().nodes[roof.children[0]!] as RoofSegmentNode
  const line = segmentWallLine(roof, segment)
  const along = Math.abs(Math.cos(line.angle)) > 0.5
  const [hx, hz] = along ? [line.hw, line.hd] : [line.hd, line.hw]
  return {
    x: [line.center[0] - hx, line.center[0] + hx],
    z: [line.center[1] - hz, line.center[1] + hz],
    wallThickness: segment.wallThickness,
  }
}

const expectExtents = (
  actual: ReturnType<typeof wallLineExtents>,
  x: [number, number],
  z: [number, number],
) => {
  for (const [i, value] of [...actual.x, ...actual.z].entries())
    expect(value).toBeCloseTo([...x, ...z][i]!, 6)
}

// A roof drawn over a porch from the Roof level: before, its corners caught the house's
// walls below but not the porch's invisible walls, and the roof's walls stood out past them.
test("a roof drawn over a porch snaps to its invisible walls, its outer faces on the porch's edge", async () => {
  const { upper } = setPorchScene('separators')
  await showViews('2d')
  const renderer = await mountTool(upper.id)
  try {
    await click(2.23, -2.37)
    await click(7.77, 0.03)
    const roof = roofs()[0] as RoofNode
    expect(roof.parentId).toBe(upper.id)
    // The house wall's centre line at z 0; 0.2 m walls, their outer faces on x 2.2, 7.8, z -2.4.
    const extents = wallLineExtents(roof)
    expect(extents.wallThickness).toBeCloseTo(0.2, 6)
    expectExtents(extents, [2.3, 7.7], [-2.3, 0])
  } finally {
    await act(async () => renderer.unmount())
  }
})

// The owner's porch clause still holds: drawn on the porch's own storey, the roof stays there on
// its posts rather than going up to the Roof level, its outer faces on the porch's edge.
test("drawn on the porch's own storey, the roof stays on it, flush with the porch", async () => {
  const { level } = setPorchScene('separators')
  await showViews('2d')
  const renderer = await mountTool(level.id)
  try {
    await click(2.23, -2.37)
    await click(7.77, 0.03)
    const roof = roofs()[0] as RoofNode
    expect(roof.parentId).toBe(level.id)
    expect(roof.support).toEqual({ kind: 'level' })
    expectExtents(wallLineExtents(roof), [2.3, 7.7], [-2.3, 0])
  } finally {
    await act(async () => renderer.unmount())
  }
})

test("a roof drawn over a deck snaps to its railings' outside faces and corners", async () => {
  const { upper } = setPorchScene('railings')
  await showViews('2d')
  const renderer = await mountTool(upper.id)
  try {
    await click(2.2 - H + 0.03, -2.4 - H + 0.03)
    await click(7.8 + H - 0.03, 0.03)
    const extents = wallLineExtents(roofs()[0] as RoofNode)
    expect(extents.wallThickness).toBeCloseTo(0.2, 6)
    expectExtents(extents, [2.3 - H, 7.7 + H], [-2.3 - H, 0])
  } finally {
    await act(async () => renderer.unmount())
  }
})

test("Room over a porch roofs it to its outside edge, on the house wall's top", async () => {
  const { upper, edges } = setPorchScene('separators')
  await showViews('2d')
  useRoofFootprintSource.setState({ source: 'room' })
  const renderer = await mountTool(upper.id)
  try {
    await move(5, -1)
    expect(useRoofFootprintSource.getState().roomPick).toBe('room')
    expect(useViewer.getState().previewSelectedIds).toEqual(
      expect.arrayContaining(edges.map((edge) => edge.id)),
    )
    await click(5, -1)
    const roof = roofs()[0] as RoofNode
    expect(roof.parentId).toBe(upper.id)
    // 2.5 m walls under a 3 m storey: the eave on the house wall's top, 0.5 m below the level.
    expect(roof.position[1]).toBeCloseTo(-0.5, 6)
    expectExtents(wallLineExtents(roof), [2.3, 7.7], [-2.3, 0])
  } finally {
    await act(async () => renderer.unmount())
  }
})

test("Room over a deck roofs it to its railings' outside faces, never on their tops", async () => {
  const { upper } = setPorchScene('railings')
  await showViews('2d')
  useRoofFootprintSource.setState({ source: 'room' })
  const renderer = await mountTool(upper.id)
  try {
    await click(5, -1)
    const roof = roofs()[0] as RoofNode
    expect(roof.position[1]).toBeCloseTo(-0.5, 6)
    const extents = wallLineExtents(roof)
    expect(extents.wallThickness).toBeCloseTo(0.2, 6)
    expectExtents(extents, [2.3 - H, 7.7 + H], [-2.3 - H, 0])
  } finally {
    await act(async () => renderer.unmount())
  }
})

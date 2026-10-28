import { afterEach, expect, test } from 'bun:test'
import {
  type AnyNode,
  type AnyNodeId,
  BuildingNode,
  clearSceneHistory,
  emitter,
  type FloorplanGeometry,
  FoundationNode,
  type GridEvent,
  LevelNode,
  type LiveNodeOverrides,
  useScene,
} from '@pascal-app/core'
import {
  getFloorplanNodeExtension,
  sceneLayout,
  useEditor,
  usePlacementPreview,
} from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { act, create } from '@react-three/test-renderer'
import { createElement } from 'react'
import { withLiveOutlines } from '../site/generic-foundation'
import { foundationDefinition } from './definition'
import { foundationFamilyOption, useFoundationDraw } from './family'
import { buildFoundationFloorplan, FOUNDATION_DRAFT_ID } from './floorplan'

type RafFn = (cb: (time: number) => void) => number
;(globalThis as unknown as { requestAnimationFrame?: RafFn }).requestAnimationFrame ??= (cb) => {
  cb(0)
  return 0
}
;(globalThis as unknown as { cancelAnimationFrame?: (id: number) => void }).cancelAnimationFrame ??=
  () => {}
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const previous = { editor: useEditor.getState(), viewer: useViewer.getState() }

afterEach(() => {
  useEditor.setState(previous.editor, true)
  useViewer.setState(previous.viewer, true)
  usePlacementPreview.getState().clear()
  useFoundationDraw.getState().setConstruction('building')
})

function setScene() {
  const building = BuildingNode.parse({})
  const ground = LevelNode.parse({ parentId: building.id, level: 0, height: 3 })
  const upper = LevelNode.parse({ parentId: building.id, level: 1, height: 3 })
  building.children = [ground.id, upper.id]
  const nodes = Object.fromEntries([building, ground, upper].map((node) => [node.id, node]))
  useScene.getState().setScene(nodes as Record<AnyNodeId, AnyNode>, [building.id as AnyNodeId], {
    installedPlugins: [],
    hasExplicitPluginInstallState: false,
  })
  clearSceneHistory()
  useViewer.getState().setSelection({ buildingId: building.id, levelId: upper.id })
  useEditor.setState({
    mode: 'build',
    tool: 'foundation',
    workspaceMode: 'edit',
    viewLayouts: { edit: sceneLayout('2d') },
  })
  return { ground }
}

const outlines = () =>
  Object.values(useScene.getState().nodes).filter(
    (node): node is FoundationNode => node.type === 'foundation',
  )

const gridEvent = (x: number, z: number) =>
  ({
    position: [x, 0, z],
    localPosition: [x, 0, z],
    nativeEvent: { altKey: true } as GridEvent['nativeEvent'],
  }) satisfies GridEvent

const move = (x: number, z: number) => act(async () => emitter.emit('grid:move', gridEvent(x, z)))
const click = (x: number, z: number) =>
  act(async () => {
    emitter.emit('grid:move', gridEvent(x, z))
    emitter.emit('grid:click', gridEvent(x, z))
  })

test('in 2D-only view a foundation is drawn corner by corner on the lowest level, closed on its first corner', async () => {
  const { ground } = setScene()
  // The tool listens for Enter on the window; the test runs without a DOM, so lend it one.
  const scope = globalThis as { window?: EventTarget }
  const lent = scope.window === undefined
  if (lent) scope.window = new EventTarget()
  const { default: PlanTool } = await getFloorplanNodeExtension(foundationDefinition)!.tool!()
  const renderer = await create(createElement(PlanTool as () => null))
  try {
    expect(useViewer.getState().selection.levelId).toBe(ground.id)
    await click(0, 0)
    await click(6, 0)
    await move(6, 4)
    // The plan's preview: the corners so far and the cursor, a draft.
    expect(usePlacementPreview.getState().node).toMatchObject({
      type: 'foundation',
      polygon: [
        [0, 0],
        [6, 0],
        [6, 4],
      ],
      id: FOUNDATION_DRAFT_ID,
    })
    await click(6, 4)
    await click(0, 4)
    expect(outlines()).toHaveLength(0)
    await click(0.1, 0.1)
    expect(outlines()).toHaveLength(1)
    expect(outlines()[0]).toMatchObject({
      parentId: ground.id,
      name: 'Foundation 1',
      construction: 'building',
      polygon: [
        [0, 0],
        [6, 0],
        [6, 4],
        [0, 4],
      ],
    })
    expect(useViewer.getState().selection.selectedIds).toEqual([outlines()[0]!.id])
    expect(usePlacementPreview.getState().node).toBeNull()

    // Enter closes it from three corners; Draw › Slab pours it as a slab of its own.
    useFoundationDraw.getState().setConstruction('slab')
    await click(10, 0)
    await click(12, 0)
    await click(12, 2)
    await act(async () => {
      scope.window!.dispatchEvent(Object.assign(new Event('keydown'), { key: 'Enter' }))
    })
    expect(outlines()).toHaveLength(2)
    expect(outlines()[1]).toMatchObject({ name: 'Slab 2', construction: 'slab' })
  } finally {
    await act(async () => renderer.unmount())
    if (lent) delete scope.window
  }
})

test('Draw picks across the family: an outline’s construction, or a footing’s shape, arming the tool that draws it', () => {
  useEditor.setState({ mode: 'select', tool: null })
  foundationFamilyOption.set('pad')
  expect(useEditor.getState()).toMatchObject({ mode: 'build', tool: 'footing' })
  expect(useEditor.getState().toolDefaults.footing?.shape).toBe('pad')
  expect(foundationFamilyOption.value()).toBe('pad')
  foundationFamilyOption.set('slab')
  expect(useEditor.getState()).toMatchObject({ mode: 'build', tool: 'foundation' })
  expect(useFoundationDraw.getState().construction).toBe('slab')
  expect(foundationFamilyOption.value()).toBe('slab')
  foundationFamilyOption.set('strip')
  expect(foundationFamilyOption.value()).toBe('strip')
})

const kinds = (geometry: FloorplanGeometry | null): string[] =>
  geometry?.kind === 'group' ? geometry.children.map((child) => child.kind) : []

test('the plan shows an outline clear at rest, its polygon editor picked, and a draft in full', () => {
  const node = FoundationNode.parse({
    parentId: 'level_a',
    polygon: [
      [0, 0],
      [4, 0],
      [4, 3],
      [0, 3],
    ],
  })
  const ctx = (selected: boolean) =>
    ({ viewState: { selected, unit: 'metric' } }) as Parameters<typeof buildFoundationFloorplan>[1]
  const rest = buildFoundationFloorplan(node, ctx(false))
  expect(kinds(rest)).toEqual(['polygon'])
  expect(rest?.kind === 'group' && rest.children[0]).toMatchObject({
    fill: 'transparent',
    stroke: 'none',
  })
  const picked = kinds(buildFoundationFloorplan(node, ctx(true)))
  expect(picked.filter((kind) => kind === 'endpoint-handle')).toHaveLength(4)
  expect(picked.filter((kind) => kind === 'midpoint-handle')).toHaveLength(4)
  expect(picked.filter((kind) => kind === 'edge-handle')).toHaveLength(4)
  expect(picked.filter((kind) => kind === 'dimension-label')).toHaveLength(4)

  // A two-corner draft is a line; a closed outline needs three corners.
  const draft = { ...node, id: FOUNDATION_DRAFT_ID, polygon: node.polygon.slice(0, 2) }
  expect(kinds(buildFoundationFloorplan(draft, ctx(false)))).toEqual(['line'])
  expect(
    buildFoundationFloorplan({ ...node, polygon: node.polygon.slice(0, 2) }, ctx(false)),
  ).toBeNull()
  expect(foundationDefinition.floorplanAffordances).toHaveProperty('move-edge')
})

test('a dragged outline reaches the concrete through its live shape; the scene stays as it is otherwise', () => {
  const outline = FoundationNode.parse({
    parentId: 'level_a',
    polygon: [
      [0, 0],
      [4, 0],
      [4, 3],
    ],
  })
  const nodes = { [outline.id]: outline } as Record<AnyNodeId, AnyNode>
  expect(withLiveOutlines(nodes, new Map())).toBe(nodes)
  const wall = new Map<string, LiveNodeOverrides>([
    ['wall_a', { start: [0, 0] } as LiveNodeOverrides],
  ])
  expect(withLiveOutlines(nodes, wall)).toBe(nodes)
  const dragged = withLiveOutlines(
    nodes,
    new Map([
      [
        outline.id,
        {
          polygon: [
            [0, 0],
            [5, 0],
            [5, 3],
          ],
        } as LiveNodeOverrides,
      ],
    ]),
  )
  expect(dragged).not.toBe(nodes)
  expect((dragged[outline.id as AnyNodeId] as FoundationNode).polygon[1]).toEqual([5, 0])
  expect(nodes[outline.id as AnyNodeId]).toBe(outline)
})

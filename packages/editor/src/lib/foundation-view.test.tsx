import { afterEach, beforeEach, expect, test } from 'bun:test'
import {
  type AnyNode,
  type AnyNodeId,
  BuildingNode,
  FoundationNode,
  LevelNode,
  SiteNode,
  SlabNode,
  useScene,
  WallNode,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  FloorplanFoundationLayer,
  FoundationPlanGroup,
  foundationPlanDrawing,
} from '../components/editor-2d/floorplan-foundation-layer'
import { FoundationRow } from '../components/ui/floating-level-selector'
import { roomPickingEnabled } from '../hooks/use-selected-room'
import useEditor from '../store/use-editor'
import { installImmediateAnimationFrames } from '../test-utils/immediate-animation-frames'
import {
  armFootingTool,
  armFoundationTool,
  editFoundationOutline,
  enterFoundationView,
  followWallsForFoundation,
  houseFoundationOutlines,
  traceFoundationFromWalls,
} from './foundation-view'

const BOX: Array<[number, number]> = [
  [0, 0],
  [10, 0],
  [10, 8],
  [0, 8],
]
const walls = BOX.map((start, index) =>
  WallNode.parse({
    id: `wall_g_${index}`,
    parentId: 'level_g',
    start,
    end: BOX[(index + 1) % BOX.length],
    thickness: 0.1,
  }),
)

/** A house on a slab, with an empty level under its ground floor (footings go there). */
const HOUSE: AnyNode[] = [
  SiteNode.parse({ id: 'site_a', children: ['building_a'] }),
  BuildingNode.parse({
    id: 'building_a',
    parentId: 'site_a',
    children: ['level_b', 'level_g'],
    metadata: { foundation: { enabled: true, type: 'slab' } },
  }),
  LevelNode.parse({ id: 'level_b', parentId: 'building_a', level: -1, children: [] }),
  LevelNode.parse({
    id: 'level_g',
    parentId: 'building_a',
    level: 0,
    children: [...walls.map((wall) => wall.id), 'slab_g'],
  }),
  SlabNode.parse({
    id: 'slab_g',
    parentId: 'level_g',
    plateRole: 'base',
    polygon: BOX,
    elevation: 0.05,
    thickness: 0.05,
  }),
  ...walls,
]

let restoreFrames: () => void = () => {}
let previous: {
  viewer: ReturnType<typeof useViewer.getState>
  scene: ReturnType<typeof useScene.getState>
  editor: ReturnType<typeof useEditor.getState>
}
beforeEach(() => {
  restoreFrames = installImmediateAnimationFrames()
  previous = {
    viewer: useViewer.getState(),
    scene: useScene.getState(),
    editor: useEditor.getState(),
  }
  useScene.setState({
    nodes: Object.fromEntries(HOUSE.map((node) => [node.id, node])) as Record<AnyNodeId, AnyNode>,
    rootNodeIds: ['site_a' as AnyNodeId],
  })
  useViewer.getState().setSelection({
    buildingId: 'building_a' as never,
    levelId: 'level_g' as never,
    selectedIds: ['wall_g_0' as never],
  })
})
afterEach(() => {
  restoreFrames()
  useViewer.setState(previous.viewer, true)
  useScene.setState(previous.scene, true)
  useEditor.setState(previous.editor, true)
})

test('the Foundation row selects the level footings go on, with nothing picked, and turns the view on', () => {
  useEditor.setState({ room: { levelId: 'level_g', zoneId: 'zone_a' } as never })
  expect(enterFoundationView('building_a')).toBe(true)
  const viewer = useViewer.getState()
  expect(viewer.foundationView).toBe(true)
  expect(viewer.selection).toMatchObject({
    buildingId: 'building_a',
    levelId: 'level_b',
    selectedIds: [],
  })
  expect(useEditor.getState().room).toBeNull()
  // Rooms are not what the view shows: a click picks a footing or nothing.
  expect(roomPickingEnabled()).toBe(false)

  // A level row picked ends it.
  useViewer.getState().setSelection({ levelId: 'level_g' as never })
  expect(useViewer.getState().foundationView).toBe(false)
  expect(enterFoundationView('nothing')).toBe(false)
})

test('Draw a footing arms the Footing tool and stays in the foundation view', () => {
  enterFoundationView('building_a')
  armFootingTool()
  expect(useEditor.getState()).toMatchObject({ mode: 'build', tool: 'footing' })
  expect(useViewer.getState().foundationView).toBe(true)
  expect(useViewer.getState().selection.levelId).toBe('level_b')
})

test('the row reads Foundation with its badge, and shows as selected while the view is on', () => {
  const row = (selected: boolean) =>
    renderToStaticMarkup(<FoundationRow badge="Slab" isSelected={selected} onSelect={() => {}} />)
  expect(row(true)).toContain('>Foundation<')
  expect(row(true)).toContain('data-foundation-badge="Slab"')
  expect(row(true)).toContain('aria-pressed="true"')
  expect(row(false)).toContain('aria-pressed="false"')
  expect(
    renderToStaticMarkup(<FoundationRow badge="Off" isSelected={false} onSelect={() => {}} />),
  ).toContain('title="No foundation drawn: click to set one up"')
})

test('the plan: the slab outlined, its edge dashed where it ends inside, under the walls merged into one faint ghost', () => {
  const nodes = useScene.getState().nodes as Record<string, AnyNode>
  const drawing = foundationPlanDrawing(nodes, 'building_a')
  expect(drawing.shapes[0]?.kind).toBe('slab')
  // The four walls are one shape: its outside and its inside, no seams at the corners.
  expect(drawing.walls).toHaveLength(2)

  // Off, the layer draws nothing (a server render reads the store as it starts: off).
  expect(renderToStaticMarkup(<FloorplanFoundationLayer />)).toBe('')
  const plan = renderToStaticMarkup(<FoundationPlanGroup drawing={drawing} />)
  expect(plan).toContain('data-foundation-member="slab"')
  expect(plan).toMatch(
    /data-foundation-hidden=""[^>]*data-foundation-member="turndown"[^>]*stroke-dasharray="6 4"/,
  )
  expect(plan).toContain('data-foundation-walls=""')
  // Dashes are the foundation's hidden lines alone: the walls are not dashed.
  expect(plan).not.toContain('stroke-dasharray="7 5"')
  expect(plan).toContain('pointer-events="none"')
})

test('Edit the outline traces the walls into an outline of its own, picked; Re-trace sets it back', () => {
  enterFoundationView('building_a')
  expect(editFoundationOutline('building_a')).toBe(true)
  const outlines = Object.values(useScene.getState().nodes).filter(
    (node) => node.type === 'foundation',
  )
  expect(outlines).toHaveLength(1)
  const outline = outlines[0]!
  // On the level footings go on, picked, the view still on.
  expect(outline.parentId).toBe('level_b')
  expect(useViewer.getState().selection.selectedIds).toEqual([outline.id])
  expect(useViewer.getState().foundationView).toBe(true)
  // Stretched, then traced again: the same outline, back at the walls' faces.
  const traced = outline.type === 'foundation' ? outline.polygon : []
  useScene.getState().updateNode(outline.id, {
    polygon: traced.map(([x, z]) => [x > 5 ? x + 2 : x, z] as [number, number]),
  })
  expect(traceFoundationFromWalls('building_a')).toEqual([outline.id])
  const back = useScene.getState().nodes[outline.id]
  expect(back?.type === 'foundation' && back.polygon).toEqual(traced)
  expect(editFoundationOutline('nothing')).toBe(false)
})

test('Draw a foundation arms the Foundation tool in the view', () => {
  enterFoundationView('building_a')
  armFoundationTool()
  expect(useEditor.getState()).toMatchObject({ mode: 'build', tool: 'foundation' })
  expect(useViewer.getState().foundationView).toBe(true)
})

test('a porch slab drawn on its own stays through Edit, Re-trace and Follow the walls', () => {
  enterFoundationView('building_a')
  const porch = FoundationNode.parse({
    name: 'Slab 1',
    construction: 'slab',
    drop: 0.04,
    polygon: [
      [2, 8],
      [6, 8],
      [6, 10],
      [2, 10],
    ],
  })
  useScene.getState().createNode(porch, 'level_b' as AnyNodeId)
  const house = () => houseFoundationOutlines(useScene.getState().nodes, 'building_a')
  // The porch is not the house's outline: the house still follows the walls, and Edit traces one.
  expect(house()).toHaveLength(0)
  expect(editFoundationOutline('building_a')).toBe(true)
  const [own] = house()
  expect(own).toBeDefined()
  expect(traceFoundationFromWalls('building_a')).toEqual([own!.id])
  // Edit again picks the outline it has, tracing none anew.
  useViewer.getState().setSelection({ selectedIds: [] })
  expect(editFoundationOutline('building_a')).toBe(true)
  expect(house().map((node) => node.id)).toEqual([own!.id])
  expect(useViewer.getState().selection.selectedIds).toEqual([own!.id])
  // Follow the walls lets the house's outline go, and its pick; the porch stays as drawn.
  followWallsForFoundation('building_a')
  expect(house()).toHaveLength(0)
  expect(useViewer.getState().selection.selectedIds).toEqual([])
  const kept = useScene.getState().nodes[porch.id]
  expect(kept?.type === 'foundation' && kept.polygon).toEqual(porch.polygon)
})

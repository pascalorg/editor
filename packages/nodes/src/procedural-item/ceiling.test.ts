import { afterEach, beforeEach, expect, test } from 'bun:test'
import {
  type AnyNode,
  type AnyNodeId,
  CeilingNode,
  canHostOnTop,
  createSceneApi,
  LevelNode,
  nodeRegistry,
  registerNode,
  useLiveNodeOverrides,
  useScene,
} from '@pascal-app/core'
import { ProceduralItemNode, parseRecipe, shelfRecipe } from '@pascal-app/core/procedural-items'
import { usePlacementPreview } from '@pascal-app/editor'
import { proceduralItemDefinition } from './definition'
import { createProceduralCeilingMoveSession, proceduralFloorplanMoveTarget } from './move-session'

globalThis.requestAnimationFrame ??= () => 0
globalThis.cancelAnimationFrame ??= () => {}

const recipe = parseRecipe({
  ...shelfRecipe,
  mounting: { attachTo: 'ceiling', reference: 'top' },
  surfaces: [{ id: 'top', label: 'Top', position: [0, 'height', 0], size: ['width', 'depth'] }],
})
const ceiling = CeilingNode.parse({
  id: 'ceiling_session',
  parentId: 'level_session',
  polygon: [
    [-4, -4],
    [4, -4],
    [4, 4],
    [-4, 4],
  ],
})
const level = LevelNode.parse({ id: ceiling.parentId, height: 3, children: [ceiling.id] })
const node = ProceduralItemNode.parse({
  id: 'procedural-item_session',
  recipe,
  parentId: ceiling.id,
})
let restore: () => void
let previous: ReturnType<typeof useScene.getState>
beforeEach(() => {
  restore = nodeRegistry._snapshot()
  previous = useScene.getState()
  registerNode(proceduralItemDefinition)
  useScene.setState({
    nodes: {
      [level.id]: level,
      [ceiling.id]: { ...ceiling, children: [node.id] },
      [node.id]: node,
    } as never,
    readOnly: false,
  })
  useScene.temporal.getState().clear()
})
afterEach(() => {
  useLiveNodeOverrides.getState().clear(node.id)
  usePlacementPreview.getState().clear()
  useScene.setState(previous)
  restore()
})

test('ceiling previews never mutate scene, rotate yaw, commit once and undo completely', () => {
  const before = useScene.getState().nodes
  const session = createProceduralCeilingMoveSession(node, level.id)
  session.ceiling(ceiling, 1, 2, false)
  session.rotate(1)
  session.rotate(-1)
  session.rotate(1)
  expect(session.canCommit()).toBe(true)
  expect(useScene.getState().nodes).toBe(before)
  expect(session.candidate).toMatchObject({
    parentId: ceiling.id,
    position: [1, 0, 2],
    rotation: [0, Math.PI / 4, 0],
  })
  session.commit()
  expect(useScene.temporal.getState().pastStates).toHaveLength(1)
  useScene.temporal.getState().undo()
  expect(useScene.getState().nodes).toEqual(before)
})

test('grid fallback stays unhosted and cannot commit even after a valid target', () => {
  const session = createProceduralCeilingMoveSession(node, level.id)
  session.ceiling(ceiling, 0, 0, true)
  session.free([8, 9])
  expect(session.candidate).toBeNull()
  expect(session.canCommit()).toBe(false)
  expect(usePlacementPreview.getState().node?.parentId).toBe(level.id)
  expect(useLiveNodeOverrides.getState().overrides.get(node.id)).toEqual({ visible: false })
})

test('Alt permits overlapping hanging designs but cannot bypass host boundaries', () => {
  const other = { ...node, id: 'procedural-item_other' }
  useScene.setState({ nodes: { ...useScene.getState().nodes, [other.id]: other } as never })
  const session = createProceduralCeilingMoveSession(node, level.id)
  session.ceiling(ceiling, 0, 0, false)
  expect(session.canCommit()).toBe(false)
  session.ceiling(ceiling, 0, 0, true)
  expect(session.canCommit()).toBe(true)
  session.ceiling(ceiling, 4, 0, true)
  expect(session.canCommit()).toBe(false)
})

test('2D target finds ceiling polygons, excludes holes, preserves yaw and reparents', () => {
  const second = CeilingNode.parse({
    ...ceiling,
    id: 'ceiling_second',
    polygon: [
      [5, 5],
      [9, 5],
      [9, 9],
      [5, 9],
    ],
    holes: [
      [
        [7, 7],
        [8, 7],
        [8, 8],
        [7, 8],
      ],
    ],
  })
  useScene.setState({
    nodes: {
      ...useScene.getState().nodes,
      [level.id]: { ...level, children: [ceiling.id, second.id] },
      [second.id]: second,
    },
  })
  const session = proceduralFloorplanMoveTarget({
    node: { ...node, rotation: [0, 0.2, 0] },
    nodes: useScene.getState().nodes,
  })
  const apply = (point: [number, number]) =>
    session.apply({
      planPoint: point,
      modifiers: { altKey: false, shiftKey: false, ctrlKey: false, metaKey: false },
    })
  apply([7.5, 7.5])
  expect(session.canCommit()).toBe(false)
  apply([6, 6])
  expect(session.canCommit()).toBe(true)
  session.commit!()
  expect(useScene.getState().nodes[node.id as AnyNodeId]).toMatchObject({
    parentId: second.id,
    rotation: [0, 0.2, 0],
    position: [6, 0, 6],
  })
})

test('definition gates floor lift and hosting, portals parameter arrows, and draws the hanging glyph', () => {
  const scene = createSceneApi(useScene)
  expect(proceduralItemDefinition.capabilities.hostable?.parents).toContain('ceiling')
  expect(
    proceduralItemDefinition.capabilities.floorPlaced?.applies?.(node as unknown as AnyNode),
  ).toBe(false)
  expect(canHostOnTop(node as unknown as AnyNode)).toBe(false)
  const handles = proceduralItemDefinition.handles
  if (typeof handles !== 'function') throw new Error('Expected handles')
  expect(
    handles(node, scene)
      .filter((h) => h.kind === 'linear-resize')
      .every((h) => h.portal === 'grandparent'),
  ).toBe(true)
  expect(handles(node, scene).some((h) => h.kind === 'arc-resize')).toBe(true)
  const glyph = proceduralItemDefinition.floorplan!(node, {
    resolve: (id: AnyNodeId) => useScene.getState().nodes[id],
    children: [],
    siblings: [],
    parent: ceiling,
  } as never)
  expect(glyph).toMatchObject({ kind: 'rect', x: -0.6, y: -0.2, width: 1.2, height: 0.4 })
})

test('fresh ceiling placement commits a clean subtree and undo removes it', async () => {
  const { commitFreshPlacementSubtree } = await import('@pascal-app/editor')
  const draft = { ...node, parentId: level.id, metadata: { isNew: true }, visible: false }
  useScene.setState({
    nodes: {
      [level.id]: { ...level, children: [ceiling.id, node.id] },
      [ceiling.id]: ceiling,
      [node.id]: draft,
    } as never,
  })
  useScene.temporal.getState().clear()
  useScene.temporal.getState().pause()
  const session = createProceduralCeilingMoveSession(draft, level.id)
  session.ceiling(ceiling, 1, 1, false)
  session.commit()
  const id = commitFreshPlacementSubtree(node.id as AnyNodeId, { visible: true })!
  useScene.temporal.getState().resume()
  expect(useScene.getState().nodes[id]).toMatchObject({
    parentId: ceiling.id,
    position: [1, 0, 1],
    visible: true,
  })
  expect(useScene.getState().nodes[id]!.metadata).not.toHaveProperty('isNew')
  expect(useScene.temporal.getState().pastStates).toHaveLength(1)
  useScene.temporal.getState().undo()
  expect(
    Object.values(useScene.getState().nodes).some(
      (n) => (n as { type: string }).type === 'procedural-item',
    ),
  ).toBe(false)
  expect(useScene.getState().nodes[ceiling.id]).toMatchObject({ children: [] })
})

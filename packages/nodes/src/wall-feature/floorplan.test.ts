import { afterEach, expect, test } from 'bun:test'
import {
  type AnyNode,
  createSceneApi,
  WallFeatureNode as FeatureSchema,
  type FloorplanGeometry,
  type GeometryContext,
  LevelNode,
  sceneRegistry,
  subscribeSceneCommits,
  useLiveNodeOverrides,
  useScene,
  type WallFeatureNode,
  WallNode,
} from '@pascal-app/core'
import {
  EDITOR_LAYER,
  useEditor,
  useInteractionScope,
  usePlacementPreview,
} from '@pascal-app/editor'
import {
  buildWallFeatureFloorplan,
  createWallFeatureDraft,
  createWallFeaturePlacementSession,
  isWallFeatureGeometryDeferred,
  proposeWallFeature,
  resetWallFeatureGeometry,
  wallFeatureDefinition,
  wallFeaturePlanAffordance,
  wallFeaturePlanHit,
  wallFeaturePlanMove,
} from '@pascal-app/nodes'
import { Group } from 'three'

const initial = useScene.getState(),
  editor = useEditor.getState(),
  scope = useInteractionScope.getState().scope
const modifiers = { shiftKey: false, altKey: true, ctrlKey: false, metaKey: false }
globalThis.requestAnimationFrame ??= (cb) => {
  cb(0)
  return 0
}
globalThis.cancelAnimationFrame ??= () => {}
afterEach(() => {
  useScene.setState(initial)
  useEditor.setState(editor)
  useInteractionScope.setState({ scope })
  usePlacementPreview.getState().clear()
  useLiveNodeOverrides.getState().clearAll()
  useScene.temporal.getState().clear()
  resetWallFeatureGeometry()
})
function setup(face: 'a' | 'b' = 'a') {
  const level = LevelNode.parse({ height: 3 })
  const wall = WallNode.parse({ parentId: level.id, start: [2, 1], end: [2, 6], thickness: 0.2 })
  const node = FeatureSchema.parse({
    parentId: wall.id,
    face,
    u: 2,
    bottom: 0.9,
    width: 0.6,
    height: 0.35,
    depth: 0.08,
  })
  wall.children = [node.id]
  level.children = [wall.id]
  const nodes: Record<string, AnyNode> = Object.fromEntries(
    [level, wall, node].map((n) => [n.id, n]),
  )
  useScene.setState({ nodes, rootNodeIds: [level.id], dirtyNodes: new Set(), readOnly: false })
  useScene.temporal.getState().resume()
  useScene.temporal.getState().clear()
  const scene = createSceneApi(useScene)
  const context: GeometryContext = {
    resolve: (id) => nodes[id],
    sceneNodes: nodes,
    children: [],
    parent: wall,
    siblings: [],
  }
  return { level, wall, node, nodes, scene, context }
}
function flatten(g: FloorplanGeometry | null): FloorplanGeometry[] {
  return !g ? [] : g.kind === 'group' ? g.children.flatMap(flatten) : [g]
}
function footprint(node: WallFeatureNode, context: GeometryContext) {
  const model = buildWallFeatureFloorplan(node, context)
  return flatten(model).find((g) => g.kind === 'polygon')
}
test('rotated-wall footprints show exact width and depth on both physical faces', () => {
  for (const face of ['a', 'b'] as const) {
    const { node, context } = setup(face)
    const p = footprint(node, context)
    if (p?.kind !== 'polygon') throw Error('Missing footprint')
    expect(
      Math.hypot(p.points[0]![0] - p.points[1]![0], p.points[0]![1] - p.points[1]![1]),
    ).toBeCloseTo(node.width)
    expect(
      Math.hypot(p.points[1]![0] - p.points[2]![0], p.points[1]![1] - p.points[2]![1]),
    ).toBeCloseTo(node.depth)
    expect(p.points[0]![0]).toBeCloseTo(face === 'a' ? 1.9 : 2.1)
  }
})
test('above, below, and intersecting cut-plane features remain selectable and have distinct symbols', () => {
  const { node, context } = setup()
  for (const [bottom, relation] of [
    [0.2, 'below'],
    [1, 'cut'],
    [2, 'above'],
  ] as const) {
    const model = buildWallFeatureFloorplan({ ...node, bottom }, context)
    if (model?.kind !== 'group') throw Error('Missing model')
    expect((model.metadata?.wallFeature as { cut: string }).cut).toBe(relation)
    expect(flatten(model).some((g) => g.kind === 'hit-line')).toBe(true)
    const p = flatten(model).find((g) => g.kind === 'polygon')
    if (p?.kind !== 'polygon') throw Error('Missing footprint')
    expect(!!p.strokeDasharray).toBe(relation !== 'cut')
  }
})
test('nested geometry resolves the root frame and follows live ancestor changes through the registry', () => {
  const { wall, node, nodes, context } = setup('b')
  const bump = FeatureSchema.parse({ ...node, mode: 'bump', width: 1, height: 1, depth: 0.2 })
  const niche = FeatureSchema.parse({
    parentId: bump.id,
    u: 0.3,
    bottom: 0.2,
    width: 0.4,
    height: 0.3,
    depth: 0.1,
  })
  nodes[bump.id] = bump
  nodes[niche.id] = niche
  const project = wallFeatureDefinition.floorplanSiblingOverrides!
  const overrides = new Map([[wall.id, { start: [4, 1], end: [4, 6] }]])
  const live = project({
    nodeId: niche.id,
    nodes: useScene.getState().nodes,
    liveTransforms: new Map(),
    liveOverrides: overrides,
  })
  const model = buildWallFeatureFloorplan(niche, {
    ...context,
    sceneNodes: live,
    resolve: (id) => live[id],
  })
  const p = flatten(model).find((g) => g.kind === 'polygon')
  if (p?.kind !== 'polygon') throw Error('Missing nested footprint')
  expect(p.points[0]![0]).toBeCloseTo(4.3)
  expect(
    buildWallFeatureFloorplan(niche, {
      ...context,
      sceneNodes: { ...nodes, [bump.id]: { ...bump, visible: false } },
    }),
  ).toBeNull()
})
test('plan movement and an equivalent 3D cursor proposal persist the same coordinates and retain elevation', () => {
  const { wall, node, nodes, scene } = setup('b')
  const hit = wallFeaturePlanHit(nodes, node, [2.2, 4], wall.parentId)
  expect(hit?.face).toBe('b')
  expect(hit?.u).toBeCloseTo(3)
  const proposal = proposeWallFeature(nodes, node, hit!, { force: true, vertical: false }, true)
  const session = wallFeaturePlanMove({ node, nodes: useScene.getState().nodes, sceneApi: scene })
  session.apply({ planPoint: [2.2, 4], modifiers })
  expect(session.canCommit()).toBe(true)
  expect(scene.get(node.id)).toBe(node)
  session.commit?.()
  const saved = scene.get(node.id) as WallFeatureNode
  expect(saved.u).toBe(proposal.node.u)
  expect(saved.bottom).toBe(node.bottom)
  expect(saved.face).toBe(proposal.node.face)
  expect(useScene.temporal.getState().pastStates).toHaveLength(1)
  useScene.temporal.getState().undo()
  expect(scene.get(node.id)).toEqual(node)
  useScene.temporal.getState().redo()
  expect((scene.get(node.id) as WallFeatureNode).u).toBe(3)
})
test('width and depth affordances use anchored dimensions and cancellation releases geometry deferral', () => {
  const { node, scene, nodes } = setup()
  const root = new Group()
  sceneRegistry.nodes.set(node.id, root)
  const start = (action: string) =>
    wallFeaturePlanAffordance.start({
      node,
      payload: { action },
      nodes: useScene.getState().nodes,
      initialPlanPoint: [1.9, 3],
      gridSnapStep: 0.1,
      sceneApi: scene,
    })
  const width = start('width-end')
  width.apply({ planPoint: [1.9, 3.5], modifiers })
  expect(width.canCommit()).toBe(true)
  expect(scene.get(node.id)).toBe(node)
  expect(root.children[0]!.layers.mask).toBe(1 << EDITOR_LAYER)
  width.commit?.()
  expect(root.children).toHaveLength(0)
  const saved = scene.get(node.id) as WallFeatureNode
  expect(saved.width).toBeCloseTo(0.8)
  expect(saved.u - saved.width / 2).toBeCloseTo(node.u - node.width / 2)
  expect(isWallFeatureGeometryDeferred(node.id)).toBe(false)
  const depth = wallFeaturePlanAffordance.start({
    node: saved,
    payload: { action: 'depth' },
    nodes: useScene.getState().nodes,
    initialPlanPoint: [1.92, 3],
    gridSnapStep: 0.1,
    sceneApi: scene,
  })
  depth.apply({ planPoint: [1.95, 3], modifiers })
  expect(depth.canCommit()).toBe(true)
  expect(useLiveNodeOverrides.getState().get(node.id)?.depth).toBeCloseTo(0.05)
  depth.cancel?.()
  expect(root.children).toHaveLength(0)
  sceneRegistry.nodes.delete(node.id)
  expect(isWallFeatureGeometryDeferred(node.id)).toBe(false)
  expect(useLiveNodeOverrides.getState().get(node.id)).toBeUndefined()
})
test('split-view session handoff protects the current preview from the previous driver cleanup', () => {
  const { node, wall, scene } = setup()
  const three = createWallFeaturePlacementSession(node, scene, true)
  three.update({ wallId: wall.id, face: 'a', u: 2.5, elevation: 1.2 })
  const plan = createWallFeaturePlacementSession(node, scene, true)
  plan.update(
    { wallId: wall.id, face: 'b', u: 3, elevation: 1.2 },
    { force: true, vertical: false },
  )
  expect(three.ownsPreview()).toBe(false)
  three.cancel()
  expect(useLiveNodeOverrides.getState().get(node.id)?.u).toBe(3)
  expect(isWallFeatureGeometryDeferred(node.id)).toBe(true)
  expect(plan.commit()).toBe(node.id)
  expect(isWallFeatureGeometryDeferred(node.id)).toBe(false)
})
test('invalid plan edits refuse commits and cancel leaves no document writes or preview state', () => {
  const { node, scene } = setup()
  let commits = 0
  const stop = subscribeSceneCommits(() => commits++)
  try {
    const session = wallFeaturePlanAffordance.start({
      node,
      payload: { action: 'depth' },
      nodes: useScene.getState().nodes,
      initialPlanPoint: [1.9, 3],
      gridSnapStep: 0.1,
      sceneApi: scene,
    })
    session.apply({ planPoint: [2.5, 3], modifiers })
    expect(session.canCommit()).toBe(false)
    session.cancel?.()
    expect(commits).toBe(0)
    expect(scene.get(node.id)).toBe(node)
  } finally {
    stop()
  }
})

test('selected plan features expose separate resize and move grips', () => {
  const { node, context } = setup()
  const model = buildWallFeatureFloorplan(node, {
    ...context,
    viewState: {
      selected: true,
      unit: 'metric',
      highlighted: false,
      hovered: false,
      moving: false,
      palette: {
        selectedStroke: '#334155',
        selectedFill: '#ffffff',
        selectedHatch: '#334155',
        wallHoverStroke: '#334155',
        endpointHandleFill: '#ffffff',
        endpointHandleStroke: '#334155',
        endpointHandleHoverStroke: '#334155',
        endpointHandleActiveFill: '#334155',
        endpointHandleActiveStroke: '#334155',
        curveHandleFill: '#ffffff',
        curveHandleStroke: '#334155',
        curveHandleHoverStroke: '#334155',
        measurementStroke: '#334155',
        measurementLabelBackground: '#ffffff',
        measurementLabelText: '#111827',
      },
    },
  })
  const geometry = flatten(model)
  expect(geometry.filter((g) => g.kind === 'endpoint-handle')).toHaveLength(3)
  expect(geometry.filter((g) => g.kind === 'move-handle')).toHaveLength(1)
  expect(wallFeaturePlanAffordance.interaction).toBe('resize')
})
test('2D niche placement fits a short bump and keeps elevation when grid snapping', () => {
  const { wall, nodes, node } = setup()
  delete nodes[node.id]
  const bump = FeatureSchema.parse({
    parentId: wall.id,
    face: 'a',
    mode: 'bump',
    u: 2,
    width: 1,
    height: 1,
    depth: 1.5,
    bottom: 0,
  })
  nodes[bump.id] = bump
  wall.children = [bump.id]
  const draft = createWallFeatureDraft(nodes, bump.id, 'niche')
  expect(draft.bottom + draft.height).toBeLessThanOrEqual(bump.height)
  const hit = wallFeaturePlanHit(nodes, draft, [1, 3], wall.parentId, bump.id)
  expect(hit?.bumpId).toBe(bump.id)
  const proposal = proposeWallFeature(nodes, draft, hit!, { gridStep: 0.1, vertical: false })
  expect(proposal.error).toBeNull()
  expect(proposal.node.bottom).toBe(draft.bottom)
})

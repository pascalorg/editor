import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  type AnyNode,
  type AnyNodeId,
  BuildingNode,
  clearSceneHistory,
  createSceneApi,
  createTerrainField,
  defaultTreeSpread,
  encodeTerrainField,
  type GeometryContext,
  LevelNode,
  SiteNode,
  SlabNode,
  TreeNode,
  useLiveNodeOverrides,
  useScene,
} from '@pascal-app/core'
import { useDrawingView } from '@pascal-app/editor'
import { disposeObject3DResources, useViewer } from '@pascal-app/viewer'
import { Mesh, MeshStandardMaterial } from 'three'
import { treeDefinition } from './definition'
import { buildTreeFloorplan } from './floorplan'
import {
  clearTreeMovePreview,
  createTreeMoveSession,
  treeFloorplanMoveTarget,
} from './floorplan-move'
import { buildTreeFarGeometry, buildTreeGeometry } from './geometry'
import { treeFloorplanDependencies, treesOnChangedGround } from './ground-invalidation'
import { treeParametrics } from './parametrics'
import { placeTree } from './placement'

const site = SiteNode.parse({ id: 'site_tree_garden' })
const tree = (extra: Partial<TreeNode> = {}) =>
  TreeNode.parse({ id: 'tree_test', parentId: site.id, seed: 37, ...extra })
const nodesOf = (...nodes: AnyNode[]) =>
  Object.fromEntries(nodes.map((node) => [node.id, node])) as Record<AnyNodeId, AnyNode>
function context(node: TreeNode, extra: AnyNode[] = []): GeometryContext {
  const nodes = nodesOf(site, node, ...extra)
  return {
    parent: nodes[site.id],
    children: [],
    siblings: [],
    sceneNodes: nodes,
    resolve: (id: AnyNodeId) => nodes[id],
  } as unknown as GeometryContext
}
function onlyMesh(group: ReturnType<typeof buildTreeGeometry>): Mesh {
  expect(group.children).toHaveLength(1)
  const mesh = group.children[0]
  if (!(mesh instanceof Mesh)) throw new Error('A tree level must be one mesh')
  return mesh
}

describe('tree render and plan adapters', () => {
  test('one indexed near mesh uses ordinary lit vertex colours and casts shadows', () => {
    const node = tree()
    const group = buildTreeGeometry(node, context(node))
    try {
      const mesh = onlyMesh(group)
      expect(mesh.name).toBe('tree-near')
      expect(mesh.material).toBeInstanceOf(MeshStandardMaterial)
      expect((mesh.material as MeshStandardMaterial).vertexColors).toBe(true)
      expect(Object.keys(mesh.geometry.attributes).sort()).toEqual(['color', 'normal', 'position'])
      expect(mesh.geometry.index?.count).toBeGreaterThan(0)
      expect(mesh.geometry.index?.count ?? Infinity).toBeLessThanOrEqual(12_000 * 3)
      expect(mesh.castShadow && mesh.receiveShadow).toBe(true)
      expect(mesh.geometry.boundingBox).not.toBeNull()
      expect(mesh.geometry.boundingSphere).not.toBeNull()
    } finally {
      disposeObject3DResources(group)
    }
  })

  test('positions and ground height do not duplicate or translate identical root-local geometry', () => {
    const first = tree({ position: [3, 0, 4] })
    const second = tree({ id: 'tree_second', position: [-8, 0, 9] })
    const field = createTerrainField({ origin: [0, 0], spacing: 1, cols: 9, rows: 9 })
    for (let row = 0; row < field.rows; row++)
      for (let col = 0; col < field.cols; col++)
        field.heights[row * field.cols + col] = col * 10 + row * 20
    const slopedSite = SiteNode.parse({ ...site, terrain: encodeTerrainField(field) })
    const firstGroup = buildTreeGeometry(first, context(first, [slopedSite]))
    const secondGroup = buildTreeGeometry(second, context(second))
    try {
      const firstMesh = onlyMesh(firstGroup)
      const secondMesh = onlyMesh(secondGroup)
      expect(firstMesh.geometry).toBe(secondMesh.geometry)
      expect(firstGroup.position.toArray()).toEqual([0, 0, 0])
      expect(firstMesh.position.x).toBe(0)
      expect(firstMesh.position.z).toBe(0)
      expect(firstMesh.position.y).toBeCloseTo(1.1, 8)
      expect(secondMesh.position.y).toBeCloseTo(-0.05, 8)
      expect(first.position).toEqual([3, 0, 4])
      expect(firstMesh.geometry.boundingBox?.min.x).toBeLessThan(0)
      expect(firstMesh.geometry.boundingBox?.max.x).toBeGreaterThan(0)
    } finally {
      disposeObject3DResources(firstGroup)
      disposeObject3DResources(secondGroup)
    }
  })

  test('support edits reuse the root-local geometry and change only the derived base', () => {
    const node = tree({ position: [4, 0, 5] })
    const lawn = SlabNode.parse({
      parentId: site.id,
      polygon: [
        [0, 0],
        [10, 0],
        [10, 10],
        [0, 10],
      ],
      elevation: 0.8,
    })
    const flat = buildTreeGeometry(node, context(node))
    const raised = buildTreeGeometry(node, context(node, [lawn]))
    try {
      expect(onlyMesh(flat).geometry).toBe(onlyMesh(raised).geometry)
      expect(onlyMesh(raised).position.y).toBeCloseTo(0.8, 8)
      expect(buildTreeFloorplan(node, context(node, [lawn]))).toEqual(
        buildTreeFloorplan(node, context(node)),
      )
    } finally {
      disposeObject3DResources(flat)
      disposeObject3DResources(raised)
    }
  })

  test('the explicit far builder remains one ordinary mesh under its triangle budget', () => {
    const node = tree()
    const near = buildTreeGeometry(node, context(node))
    const far = buildTreeFarGeometry(node, context(node))
    try {
      const mesh = onlyMesh(far)
      expect(mesh.name).toBe('tree-far')
      expect(mesh.geometry.index?.count ?? Infinity).toBeLessThanOrEqual(600 * 3)
      expect(mesh.geometry).not.toBe(onlyMesh(near).geometry)
      expect(mesh.material).toBeInstanceOf(MeshStandardMaterial)
    } finally {
      disposeObject3DResources(near)
      disposeObject3DResources(far)
    }
  })

  test('disposing one tree preserves its shared peer; the last owner disposes once', () => {
    const first = buildTreeGeometry(tree(), context(tree()))
    const second = buildTreeGeometry(tree({ id: 'tree_peer' }), context(tree()))
    const shared = onlyMesh(first).geometry
    let disposals = 0
    shared.addEventListener('dispose', () => disposals++)
    disposeObject3DResources(first)
    expect(disposals).toBe(0)
    expect(onlyMesh(second).geometry).toBe(shared)
    disposeObject3DResources(first)
    expect(disposals).toBe(0)
    disposeObject3DResources(second)
    expect(disposals).toBe(1)
    const rebuilt = buildTreeGeometry(tree(), context(tree()))
    expect(onlyMesh(rebuilt).geometry).not.toBe(shared)
    disposeObject3DResources(rebuilt)
  })

  test('the Site symbol is a spread-sized canopy circle and a smaller trunk dot', () => {
    const node = tree({ position: [11, 0, -7], spreadM: 6, foliage: '#c26832' })
    const symbol = buildTreeFloorplan(node, context(node))
    if (symbol.kind !== 'group') throw new Error('Missing grouped tree symbol')
    expect(symbol.children).toHaveLength(2)
    expect(symbol.children[0]).toMatchObject({
      kind: 'circle',
      cx: 11,
      cy: -7,
      r: 3,
      fill: '#c26832',
      stroke: '#526443',
      strokeWidth: 1,
      vectorEffect: 'non-scaling-stroke',
    })
    const dot = symbol.children[1]
    if (dot?.kind !== 'circle') throw new Error('Missing trunk dot')
    expect([dot.cx, dot.cy]).toEqual([11, -7])
    expect(dot.r).toBeGreaterThan(0)
    expect(dot.r).toBeLessThan(3)
    const selected = buildTreeFloorplan(node, {
      ...context(node),
      viewState: {
        selected: true,
        palette: { selectedFill: '#abcdef', selectedStroke: '#123456' },
      },
    } as GeometryContext)
    if (selected.kind !== 'group') throw new Error('Missing selected tree symbol')
    expect(selected.children[0]).toMatchObject({ fill: '#abcdef', stroke: '#123456' })
  })

  test('an omitted spread has the same crown and geometry as the derived default', () => {
    const node = tree({ form: 'upright', heightM: 12 })
    const explicit = tree({ ...node, spreadM: defaultTreeSpread('upright', 12) })
    expect(buildTreeFloorplan(node, context(node))).toEqual(
      buildTreeFloorplan(explicit, context(explicit)),
    )
    const first = buildTreeGeometry(node, context(node))
    const second = buildTreeGeometry(explicit, context(explicit))
    expect(onlyMesh(first).geometry).toBe(onlyMesh(second).geometry)
    disposeObject3DResources(first)
    disposeObject3DResources(second)
  })
})

describe('tree editing', () => {
  let restore = () => {}
  beforeEach(() => {
    const original = {
      scene: useScene.getState(),
      overrides: useLiveNodeOverrides.getState(),
      viewer: useViewer.getState(),
      drawing: useDrawingView.getState(),
      frame: globalThis.requestAnimationFrame,
      cancel: globalThis.cancelAnimationFrame,
    }
    restore = () => {
      useScene.setState(original.scene)
      useLiveNodeOverrides.setState(original.overrides)
      useViewer.setState(original.viewer)
      useDrawingView.setState(original.drawing)
      globalThis.requestAnimationFrame = original.frame
      globalThis.cancelAnimationFrame = original.cancel
      clearSceneHistory()
    }
    globalThis.requestAnimationFrame = (callback) => {
      callback(0)
      return 0
    }
    globalThis.cancelAnimationFrame = () => {}
    useScene.setState({ nodes: nodesOf(site), rootNodeIds: [site.id], readOnly: false })
    useLiveNodeOverrides.getState().clearAll()
    useScene.temporal.getState().resume()
    clearSceneHistory()
  })
  afterEach(() => restore())

  test('the definition owns both view tools, custom moves and the compact inspector', async () => {
    expect(treeDefinition.floorplanScope).toBe('site')
    expect(treeDefinition.sitePlan).toBe(true)
    expect(treeDefinition.capabilities.hostable?.parents).toEqual(['site'])
    expect(treeDefinition.floorplanMoveTarget).toBe(treeFloorplanMoveTarget)
    expect(typeof (await treeDefinition.tool?.())?.default).toBe('function')
    expect(typeof (await treeDefinition.affordanceTools?.move?.())?.default).toBe('function')
    const extension = treeDefinition.extensions?.['pascal:editor/floorplan'] as {
      tool?: () => Promise<{ default: unknown }>
    }
    expect(typeof (await extension.tool?.())?.default).toBe('function')
    expect(
      treeParametrics.groups.flatMap((group) => group.fields.map((field) => field.key)),
    ).toEqual(['form', 'heightM', 'spreadM', 'foliage', 'density'])
    expect(treeParametrics.actions?.map((action) => action.label)).toEqual(['Randomise'])
  })

  test('hand placement creates one Site child at Y=0 and selects it in one undo step', () => {
    const selected: AnyNodeId[] = []
    const id = placeTree(createSceneApi(useScene), [8, -4], (id) => selected.push(id), site.id)
    if (!id) throw new Error('Expected a planted tree')
    expect(selected).toEqual([id])
    expect(useScene.getState().nodes[id]).toMatchObject({
      type: 'tree',
      parentId: site.id,
      position: [8, 0, -4],
    })
    expect(useScene.temporal.getState().pastStates).toHaveLength(1)
    useScene.temporal.getState().undo()
    expect(useScene.getState().nodes[id]).toBeUndefined()
  })

  const modifiers = { altKey: true, shiftKey: false, ctrlKey: false, metaKey: false }
  test('move preview and cancellation write no scene data; a valid commit writes once', () => {
    const node = tree({ position: [8, 0, 7] })
    useScene.setState({ nodes: nodesOf(site, node) })
    clearSceneHistory()
    const session = createTreeMoveSession({ node, nodes: useScene.getState().nodes })
    session.apply({ planPoint: [0, 0], modifiers })
    session.apply({ planPoint: [2, 3], modifiers })
    expect(useScene.getState().nodes[node.id]).toBe(node)
    expect(useLiveNodeOverrides.getState().get(node.id)).toMatchObject({ position: [10, 0, 10] })
    clearTreeMovePreview(node.id)
    expect(useLiveNodeOverrides.getState().get(node.id)).toBeUndefined()
    expect(useScene.temporal.getState().pastStates).toHaveLength(0)
    session.apply({ planPoint: [3, 4], modifiers })
    expect(session.canCommit()).toBe(true)
    expect(session.canCommit()).toBe(true)
    session.commit?.()
    session.commit?.()
    expect(useScene.getState().nodes[node.id]).toMatchObject({ position: [11, 0, 11] })
    expect(useLiveNodeOverrides.getState().get(node.id)).toBeUndefined()
    expect(useScene.temporal.getState().pastStates).toHaveLength(1)
  })

  test('both placement and a forced move refuse a trunk inside the real building footprint', () => {
    const node = tree({ position: [8, 0, 8] })
    const building = BuildingNode.parse({ parentId: site.id })
    const level = LevelNode.parse({ parentId: building.id, level: 0 })
    const slab = SlabNode.parse({
      parentId: level.id,
      polygon: [
        [-2, -2],
        [2, -2],
        [2, 2],
        [-2, 2],
      ],
    })
    useScene.setState({ nodes: nodesOf(site, node, building, level, slab) })
    const before = useScene.getState().nodes
    const refusals: string[] = []
    expect(
      placeTree(
        createSceneApi(useScene),
        [0, 0],
        () => {},
        site.id,
        (code) => refusals.push(code),
      ),
    ).toBeNull()
    expect(refusals).toEqual(['tree_inside_building'])
    expect(useScene.getState().nodes).toBe(before)
    const session = createTreeMoveSession({ node, nodes: before })
    session.apply({ planPoint: [8, 8], modifiers })
    session.apply({ planPoint: [0, 0], modifiers })
    expect(session.canCommit()).toBe(false)
    session.commit?.()
    expect(useScene.getState().nodes).toBe(before)
    clearTreeMovePreview(node.id)
  })

  test('a building moving under the preview is rechecked before committing', () => {
    const node = tree({ position: [8, 0, 8] })
    const building = BuildingNode.parse({ parentId: site.id, position: [30, 0, 30] })
    const level = LevelNode.parse({ parentId: building.id, level: 0 })
    const slab = SlabNode.parse({
      parentId: level.id,
      polygon: [
        [-2, -2],
        [2, -2],
        [2, 2],
        [-2, 2],
      ],
    })
    useScene.setState({ nodes: nodesOf(site, node, building, level, slab) })
    const session = createTreeMoveSession({ node, nodes: useScene.getState().nodes })
    session.apply({ planPoint: [8, 8], modifiers })
    session.apply({ planPoint: [0, 0], modifiers })
    expect(session.canCommit()).toBe(true)
    useScene.getState().updateNode(building.id, { position: [0, 0, 0] })
    const before = useScene.getState().nodes
    session.commit?.()
    expect(useScene.getState().nodes).toBe(before)
    expect(useScene.getState().nodes[node.id]).toBe(node)
  })

  test('plan movement converts a translated, rotated building cursor to Site metres', () => {
    const node = tree({ position: [15, 0, 8] })
    const building = BuildingNode.parse({
      parentId: site.id,
      position: [10, 0, 5],
      rotation: [0, Math.PI / 2, 0],
    })
    const level = LevelNode.parse({ parentId: building.id, level: 0 })
    useScene.setState({ nodes: nodesOf(site, node, building, level) })
    useViewer.getState().setSelection({ levelId: level.id })
    useDrawingView.setState({ drawingType: 'floor-plan' })
    const session = treeFloorplanMoveTarget({ node, nodes: useScene.getState().nodes })
    session.apply({ planPoint: [0, 0], modifiers })
    session.apply({ planPoint: [2, 3], modifiers })
    // A quarter turn maps a plan delta (2,3) to a Site delta (3,-2).
    expect(useLiveNodeOverrides.getState().get(node.id)).toMatchObject({ position: [18, 0, 6] })
  })
})

test('ground invalidation and plan dependencies remain restricted to the owning Site', () => {
  const node = tree()
  const otherSite = SiteNode.parse({ id: 'site_other_tree' })
  const other = tree({ id: 'tree_other', parentId: otherSite.id })
  const slab = SlabNode.parse({
    parentId: site.id,
    polygon: [
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
    ],
  })
  const nodes = nodesOf(site, node, otherSite, other, slab)
  const initial = treesOnChangedGround(nodes, new Map())
  expect(initial.dirty).toEqual([])
  expect(treesOnChangedGround(nodes, initial.parts).dirty).toEqual([])
  expect(
    treesOnChangedGround({ ...nodes, [slab.id]: { ...slab, elevation: 0.8 } }, initial.parts).dirty,
  ).toEqual([node.id])
  expect(
    treesOnChangedGround({ ...nodes, [node.id]: { ...node, seed: 42 } }, initial.parts).dirty,
  ).toEqual([])
  expect(treeFloorplanDependencies(node, nodes)).toEqual([site.id, slab.id])
})

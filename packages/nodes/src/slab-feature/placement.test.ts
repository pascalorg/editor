import { afterEach, expect, test } from 'bun:test'
import {
  type AnyNode,
  createSceneApi,
  LevelNode,
  planSlabFeaturePlacement,
  resolveSlabFeaturePlacement,
  SlabFeatureNode,
  SlabNode,
  useLiveNodeOverrides,
  useScene,
} from '@pascal-app/core'
import { usePlacementPreview } from '@pascal-app/editor'
import {
  buildSlabFeatureBody,
  createSlabFeaturePlacementSession,
  slabAddVertexAffordance,
  slabDeleteVertexAffordance,
  slabFeatureAgentOperations,
  slabFeatureLocalFrame,
  slabFeatureRenderNodes,
  slabMoveEdgeAffordance,
  slabMoveVertexAffordance,
} from '@pascal-app/nodes'
import { BoxGeometry, Vector3 } from 'three'

const initial = useScene.getState()
globalThis.requestAnimationFrame ??= (callback) => {
  callback(0)
  return 0
}
globalThis.cancelAnimationFrame ??= () => {}
afterEach(() => {
  useScene.setState(initial)
  useLiveNodeOverrides.getState().clearAll()
  usePlacementPreview.getState().clear()
  useScene.temporal.getState().clear()
})
function setup() {
  const level = LevelNode.parse({ height: 3 })
  const slab = SlabNode.parse({
    parentId: level.id,
    polygon: [
      [0, 0],
      [4, 0],
      [4, 4],
      [0, 4],
    ],
    thickness: 0.3,
    elevation: 0,
  })
  const bump = SlabFeatureNode.parse({
    parentId: slab.id,
    mode: 'bump',
    x: 2,
    z: 2,
    width: 1,
    length: 1,
    depth: 0.2,
  })
  slab.children = [bump.id]
  level.children = [slab.id]
  const nodes: Record<string, AnyNode> = Object.fromEntries(
    [level, slab, bump].map((n) => [n.id, n]),
  )
  useScene.setState({ nodes, rootNodeIds: [level.id], dirtyNodes: new Set(), readOnly: false })
  useScene.temporal.getState().resume()
  useScene.temporal.getState().clear()
  return { nodes, slab, bump, scene: createSceneApi(useScene) }
}
test('a predecessor cannot erase or commit the successor preview', () => {
  const { bump, scene } = setup()
  const old = createSlabFeaturePlacementSession(bump, scene, true)
  const next = createSlabFeaturePlacementSession(bump, scene, true)
  old.update([1, 1], true)
  const proposal = next.update([3, 3], true)!
  usePlacementPreview.getState().set(proposal.node)
  old.cancel()
  expect(useLiveNodeOverrides.getState().get(bump.id)).toEqual({ x: 3, z: 3 })
  expect(usePlacementPreview.getState().node?.id).toBe(bump.id)
  expect(old.commit()).toBeNull()
  expect(next.commit()).toBe(bump.id)
  expect(scene.get(bump.id)).toMatchObject({ x: 3, z: 3 })
  expect(useLiveNodeOverrides.getState().get(bump.id)).toBeUndefined()
  expect(usePlacementPreview.getState().node).toBeNull()
})
test('render snapshots share ancestor identities and preserve the feature ghost frame', () => {
  const { nodes, slab, bump } = setup()
  useLiveNodeOverrides.getState().set(slab.id, { elevation: 1 })
  useLiveNodeOverrides.getState().set(bump.id, { x: 3 })
  const graph = slabFeatureRenderNodes(nodes)
  expect(slabFeatureRenderNodes(nodes)).toBe(graph)
  expect(graph[slab.id]).toBe(graph[slab.id])
  expect(slabFeatureLocalFrame(bump, { nodes: graph, planOnly: false }).position).toEqual([2, 1, 2])
  useLiveNodeOverrides.getState().set(slab.id, { elevation: 2 })
  expect(
    slabFeatureLocalFrame(bump, { nodes: slabFeatureRenderNodes(nodes), planOnly: false }).position,
  ).toEqual([2, 2, 2])
})
test('manual and agent placement enforce the same nested backing', () => {
  const { nodes, bump } = setup()
  for (const depth of [0.48, 0.49]) {
    const niche = SlabFeatureNode.parse({
      parentId: bump.id,
      mode: 'niche',
      x: 0,
      z: 0,
      width: 0.5,
      length: 0.5,
      depth,
    })
    const manual = () => planSlabFeaturePlacement(nodes, niche)
    const agent = () =>
      slabFeatureAgentOperations.pascal_create_slab_feature(nodes, {
        hostId: bump.id,
        mode: 'niche',
        x: 0,
        z: 0,
        width: 0.5,
        length: 0.5,
        depth,
      })
    if (depth === 0.48) {
      expect(manual).not.toThrow()
      expect(agent).not.toThrow()
    } else {
      expect(manual).toThrow()
      expect(agent).toThrow()
    }
  }
})
const modifiers = { altKey: true, shiftKey: false, ctrlKey: false, metaKey: false }
test('slab outline drags preview without document writes and commit one undo step', () => {
  for (const [affordance, payload, point] of [
    [slabMoveVertexAffordance, { vertexIndex: 1 }, [5, 0]],
    [slabAddVertexAffordance, { edgeIndex: 1 }, [5, 2]],
    [slabMoveEdgeAffordance, { edgeIndex: 1 }, [5, 2]],
  ] as const) {
    const { nodes, slab, scene } = setup()
    const session = affordance.start({
      node: slab,
      nodes,
      payload,
      initialPlanPoint: [4, 2],
      gridSnapStep: 0,
      sceneApi: scene,
    })
    session.apply({ planPoint: point, modifiers })
    expect(useScene.getState().nodes).toBe(nodes)
    expect(useLiveNodeOverrides.getState().get(slab.id)?.polygon).toBeDefined()
    expect(session.canCommit()).toBe(true)
    session.commit!()
    expect(useScene.getState().nodes[slab.id]).not.toBe(slab)
    expect(useScene.temporal.getState().pastStates.length).toBe(1)
    useScene.temporal.getState().undo()
    expect(useScene.getState().nodes[slab.id]).toEqual(slab)
  }
})
test('invalid outlines retain the last valid preview; cancellation leaves the slab unchanged', () => {
  const { nodes, slab, scene } = setup()
  const session = slabMoveEdgeAffordance.start({
    node: slab,
    nodes,
    payload: { edgeIndex: 1 },
    initialPlanPoint: [4, 2],
    gridSnapStep: 0,
    sceneApi: scene,
  })
  session.apply({ planPoint: [5, 2], modifiers })
  const last = useLiveNodeOverrides.getState().get(slab.id)
  session.apply({ planPoint: [1, 2], modifiers })
  expect(useLiveNodeOverrides.getState().get(slab.id)).toBe(last)
  session.cancel!()
  expect(useScene.getState().nodes).toBe(nodes)
  expect(useLiveNodeOverrides.getState().get(slab.id)).toBeUndefined()
})
test('nested CSG emits one slab solid with the bump and recessed niche volume', () => {
  const { nodes, slab, bump } = setup()
  const niche = SlabFeatureNode.parse({
    parentId: bump.id,
    mode: 'niche',
    x: 0,
    z: 0,
    width: 0.5,
    length: 0.5,
    depth: 0.1,
  })
  nodes[niche.id] = niche
  bump.children = [niche.id]
  const body = new BoxGeometry(4, 0.3, 4)
  body.translate(2, -0.15, 2)
  const result = buildSlabFeatureBody(
    body,
    [bump, niche].map((n) => resolveSlabFeaturePlacement(nodes, n)),
  )
  let volume = 0
  const a = new Vector3(),
    b = new Vector3(),
    c = new Vector3()
  for (const geometry of [result.body, ...result.features.values()]) {
    const p = geometry.getAttribute('position')
    for (let i = 0; i < p.count; i += 3) {
      a.fromBufferAttribute(p, i)
      b.fromBufferAttribute(p, i + 1)
      c.fromBufferAttribute(p, i + 2)
      volume += a.dot(b.cross(c)) / 6
    }
    geometry.dispose()
  }
  expect(Math.abs(volume)).toBeCloseTo(4.8 + 0.2 - 0.025, 4)
  expect(result.features.size).toBe(2)
})

test('hole edits stay transient and commit once without changing boundary ownership', () => {
  const { nodes, slab, scene } = setup()
  slab.holes = [
    [
      [0.1, 0.1],
      [0.5, 0.1],
      [0.5, 0.5],
      [0.1, 0.5],
    ],
  ]
  const session = slabMoveVertexAffordance.start({
    node: slab,
    nodes,
    payload: { vertexIndex: 1, holeIndex: 0 },
    initialPlanPoint: [0.5, 0.1],
    gridSnapStep: 0,
    sceneApi: scene,
  })
  session.apply({ planPoint: [0.7, 0.1], modifiers })
  expect(useScene.getState().nodes).toBe(nodes)
  expect(slab.holes[0]![1]).toEqual([0.5, 0.1])
  session.commit!()
  expect(scene.get(slab.id)).toMatchObject({
    polygon: slab.polygon,
    holes: [
      [
        [0.1, 0.1],
        [0.7, 0.1],
        [0.5, 0.5],
        [0.1, 0.5],
      ],
    ],
  })
  expect(useScene.temporal.getState().pastStates.length).toBe(1)
})
test('deleting a vertex cannot cut through an owned feature', () => {
  const { nodes, slab, scene } = setup()
  const session = slabDeleteVertexAffordance.start({
    node: slab,
    nodes,
    payload: { vertexIndex: 3 },
    initialPlanPoint: [0, 4],
    gridSnapStep: 0,
    sceneApi: scene,
  })
  session.commit!()
  expect(useScene.getState().nodes).toBe(nodes)
})

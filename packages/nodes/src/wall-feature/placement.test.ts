import { afterEach, expect, test } from 'bun:test'
import {
  type AnyNode,
  createSceneApi,
  LevelNode,
  subscribeSceneCommits,
  useLiveNodeOverrides,
  useScene,
  WallFeatureNode,
  WallNode,
  wallSupportForNodes,
} from '@pascal-app/core'
import {
  createWallFeatureDraft,
  createWallFeaturePlacementSession,
  isWallFeatureGeometryDeferred,
  proposeWallFeature,
  resetWallFeatureGeometry,
  syncWallFeatureGeometry,
  wallFeatureHandles,
  wallGeometryAdapter,
} from '@pascal-app/nodes'
import { BoxGeometry } from 'three'

const initial = useScene.getState()
globalThis.requestAnimationFrame ??= (callback) => {
  callback(0)
  return 0
}
globalThis.cancelAnimationFrame ??= () => {}
afterEach(() => {
  useScene.setState(initial)
  useLiveNodeOverrides.getState().clearAll()
  useScene.temporal.getState().clear()
  resetWallFeatureGeometry()
})
function setup() {
  const level = LevelNode.parse({ height: 3 })
  const wall = WallNode.parse({ parentId: level.id, start: [0, 0], end: [5, 0], thickness: 0.2 })
  const other = WallNode.parse({ parentId: level.id, start: [0, 3], end: [5, 3], thickness: 0.2 })
  level.children = [wall.id, other.id]
  const nodes: Record<string, AnyNode> = Object.fromEntries(
    [level, wall, other].map((n) => [n.id, n]),
  )
  useScene.setState({ nodes, dirtyNodes: new Set(), rootNodeIds: [level.id], readOnly: false })
  useScene.temporal.getState().resume()
  useScene.temporal.getState().clear()
  return { nodes, wall, other, scene: createSceneApi(useScene) }
}
test('cursor height places niches on either face; new bumps start at the host floor', () => {
  const { nodes, wall } = setup()
  for (const face of ['a', 'b'] as const) {
    const niche = WallFeatureNode.parse({ face })
    const hit = { wallId: wall.id, face, u: 2, elevation: 1.5 }
    const p = proposeWallFeature(nodes, niche, hit)
    expect(p.error).toBeNull()
    expect(p.node.bottom).toBeCloseTo(1.325)
    expect(p.node.face).toBe(face)
    const bump = WallFeatureNode.parse({ face, mode: 'bump', width: 0.9, height: 1, depth: 0.15 })
    expect(proposeWallFeature(nodes, bump, hit).node.bottom).toBe(0)
    expect(proposeWallFeature(nodes, bump, hit, {}, true).node.bottom).toBe(1)
  }
})
test('nested cursor coordinates are relative to the bump and inherit its face', () => {
  const { nodes, wall } = setup()
  const bump = WallFeatureNode.parse({
    parentId: wall.id,
    face: 'b',
    mode: 'bump',
    u: 2,
    width: 1,
    height: 1,
    bottom: 0.5,
    depth: 0.2,
  })
  nodes[bump.id] = bump
  const niche = WallFeatureNode.parse({ width: 0.4, height: 0.3, depth: 0.1 })
  const result = proposeWallFeature(nodes, niche, {
    wallId: wall.id,
    bumpId: bump.id,
    face: 'b',
    u: 1.9,
    elevation: 1,
  })
  expect(result.error).toBeNull()
  expect(result.node.parentId).toBe(bump.id)
  expect(result.node.face).toBeUndefined()
  expect(result.node.u).toBeCloseTo(0.4)
  expect(result.node.bottom).toBeCloseTo(0.35)
})
test('grid and magnetic snapping are explicit; Alt uses the raw cursor while retaining backing validation', () => {
  const { nodes, wall } = setup()
  const niche = WallFeatureNode.parse({ face: 'a' })
  const hit = { wallId: wall.id, face: 'a' as const, u: 1.37, elevation: 1.49 }
  expect(proposeWallFeature(nodes, niche, hit, { gridStep: 0.1 }).node.u).toBeCloseTo(1.4)
  expect(proposeWallFeature(nodes, niche, hit, { gridStep: 0.1, force: true }).node.u).toBe(1.37)
  expect(
    proposeWallFeature(nodes, niche, { ...hit, u: 0.34 }, { magnetic: true }).node.u,
  ).toBeCloseTo(0.3)
  expect(
    proposeWallFeature(nodes, { ...niche, depth: 0.3 }, hit, { force: true }).placement,
  ).toBeNull()
})
test('placement has no per-tick document writes, creates once, and undo/redo restores ownership', () => {
  const { wall, scene } = setup()
  const node = WallFeatureNode.parse({ face: 'a', metadata: { isNew: true } })
  const session = createWallFeaturePlacementSession(node, scene)
  let commits = 0
  const stop = subscribeSceneCommits(() => commits++)
  try {
    for (const u of [1, 1.1, 1.2]) session.update({ wallId: wall.id, face: 'a', u, elevation: 1.5 })
    expect(commits).toBe(0)
    expect(scene.get(node.id)).toBeUndefined()
    expect(useScene.temporal.getState().pastStates).toHaveLength(0)
    expect(session.commit()).toBe(node.id)
    expect(commits).toBe(1)
    expect(useLiveNodeOverrides.getState().get(node.id)).toBeUndefined()
    expect(scene.get(node.id)?.metadata.isNew).toBeUndefined()
    expect((scene.get(wall.id) as WallNode).children).toContain(node.id)
    expect(useScene.temporal.getState().pastStates).toHaveLength(1)
    useScene.temporal.getState().undo()
    expect(scene.get(node.id)).toBeUndefined()
    useScene.temporal.getState().redo()
    expect(scene.get(node.id)?.parentId).toBe(wall.id)
    expect(session.commit()).toBeNull()
  } finally {
    stop()
  }
})
test('moving preserves source booleans until commit, reparents once, and clears only owned overrides', () => {
  const { wall, other, scene } = setup()
  const node = WallFeatureNode.parse({ parentId: wall.id, face: 'a', u: 1 })
  scene.upsert(node, wall.id)
  syncWallFeatureGeometry()
  useScene.setState({ dirtyNodes: new Set() })
  useScene.temporal.getState().clear()
  useLiveNodeOverrides.getState().set(node.id, { name: 'Other preview' })
  const session = createWallFeaturePlacementSession(node, scene, true)
  for (const u of [2, 2.1, 2.2]) {
    session.update({ wallId: other.id, face: 'b', u, elevation: 1.5 })
    syncWallFeatureGeometry()
    expect(useScene.getState().dirtyNodes.has(wall.id)).toBe(false)
    expect(useScene.getState().dirtyNodes.has(other.id)).toBe(false)
  }
  expect(isWallFeatureGeometryDeferred(node.id)).toBe(true)
  expect(
    wallGeometryAdapter.bodyModifier?.(other, { nodes: scene.nodes(), elevation: 0 }),
  ).toBeUndefined()
  expect(
    wallGeometryAdapter.bodyModifier?.(wall, { nodes: scene.nodes(), elevation: 0 }),
  ).toBeDefined()
  expect(scene.get(node.id)?.parentId).toBe(wall.id)
  session.commit()
  syncWallFeatureGeometry()
  expect(scene.get(node.id)?.parentId).toBe(other.id)
  expect((scene.get(wall.id) as WallNode).children).not.toContain(node.id)
  expect((scene.get(other.id) as WallNode).children).toContain(node.id)
  expect(useScene.temporal.getState().pastStates).toHaveLength(1)
  expect(useScene.getState().dirtyNodes.has(wall.id)).toBe(true)
  expect(useScene.getState().dirtyNodes.has(other.id)).toBe(true)
  expect(useLiveNodeOverrides.getState().get(node.id)).toEqual({ name: 'Other preview' })
  expect(isWallFeatureGeometryDeferred(node.id)).toBe(false)
  useScene.temporal.getState().undo()
  expect(scene.get(node.id)?.parentId).toBe(wall.id)
  useScene.temporal.getState().redo()
  expect(scene.get(node.id)?.parentId).toBe(other.id)
})
test('cancel and invalid targets clear the preview without creating history', () => {
  const { wall, scene } = setup()
  const node = WallFeatureNode.parse({ parentId: wall.id, face: 'a', u: 1 })
  scene.upsert(node, wall.id)
  useScene.temporal.getState().clear()
  const session = createWallFeaturePlacementSession(node, scene, true)
  session.update({ wallId: wall.id, face: 'a', u: 2, elevation: 1.5 })
  session.update({ wallId: wall.id, face: 'a', u: -4, elevation: 1.5 })
  expect(session.commit()).toBeNull()
  expect(useLiveNodeOverrides.getState().get(node.id)).toBeUndefined()
  session.update({ wallId: wall.id, face: 'a', u: 2, elevation: 1.5 })
  session.cancel()
  expect(scene.get(node.id)).toEqual(node)
  expect(useLiveNodeOverrides.getState().get(node.id)).toBeUndefined()
  expect(useScene.temporal.getState().pastStates).toHaveLength(0)
  expect(isWallFeatureGeometryDeferred(node.id)).toBe(false)
})
test('live support changes the preview datum without changing host-relative saved values', () => {
  const { nodes, wall } = setup()
  const node = WallFeatureNode.parse({ face: 'a' })
  const support = wallSupportForNodes(wall, nodes)
  const raised = {
    ...support,
    elevation: 0.5,
    faceDatum: {
      a: [{ start: 0, end: 1, elevation: 0.5 }],
      b: [{ start: 0, end: 1, elevation: 0.5 }],
    },
  }
  const proposal = proposeWallFeature(nodes, node, {
    wallId: wall.id,
    face: 'a',
    u: 2,
    elevation: 2,
    context: { support: raised },
  })
  expect(proposal.error).toBeNull()
  expect(proposal.node.bottom).toBeCloseTo(1.325)
  expect(proposal.placement?.bottom).toBeCloseTo(1.825)
})
test('resizing uses live overrides while keeping the root solid unchanged until release', () => {
  const { wall, scene } = setup()
  const node = WallFeatureNode.parse({ parentId: wall.id, face: 'a', u: 1 })
  scene.upsert(node, wall.id)
  syncWallFeatureGeometry()
  useScene.setState({ dirtyNodes: new Set() })
  const handle = wallFeatureHandles(node, scene)[0]!
  if (handle.kind !== 'linear-resize') throw Error('Missing width handle')
  const patch = handle.apply(node, 0.8, scene)
  handle.onDrag?.({ ...node, ...patch }, scene)
  useLiveNodeOverrides.getState().set(node.id, patch)
  syncWallFeatureGeometry()
  expect(useScene.getState().dirtyNodes.has(wall.id)).toBe(false)
  const geometry = new BoxGeometry(5, 3, 0.2)
  geometry.translate(2.5, 1.5, 0)
  const result = wallGeometryAdapter.bodyModifier!(wall, { nodes: scene.nodes(), elevation: 0 })!(
    geometry,
  )
  expect(isWallFeatureGeometryDeferred(node.id)).toBe(true)
  result.geometry.dispose()
  handle.commit?.(node, patch, scene)
  useLiveNodeOverrides.getState().clear(node.id)
  handle.onDragEnd?.(node, scene)
  syncWallFeatureGeometry()
  expect(useScene.getState().dirtyNodes.has(wall.id)).toBe(true)
})

test('draft dimensions fit a thin or small host without reducing required backing', () => {
  const { nodes, wall } = setup()
  nodes[wall.id] = { ...wall, thickness: 0.1 }
  const draft = createWallFeatureDraft(nodes, wall.id, 'niche')
  expect(draft.depth).toBeCloseTo(0.08)
  expect(
    proposeWallFeature(nodes, draft, { wallId: wall.id, face: 'a', u: 2, elevation: 1.5 }).error,
  ).toBeNull()
  nodes[wall.id] = { ...wall, thickness: 0.02 }
  expect(() => createWallFeatureDraft(nodes, wall.id, 'niche')).toThrow()
  expect(createWallFeatureDraft(nodes, wall.id, 'bump').depth).toBe(0.15)
})
test('a host changed after preview is revalidated at commit and the failed preview is cleared', () => {
  const { wall, scene } = setup()
  const node = WallFeatureNode.parse({ face: 'a' })
  const session = createWallFeaturePlacementSession(node, scene)
  session.update({ wallId: wall.id, face: 'a', u: 2, elevation: 1.5 })
  scene.update(wall.id, { thickness: 0.05 })
  expect(() => session.commit()).toThrow()
  expect(scene.get(node.id)).toBeUndefined()
  expect(useLiveNodeOverrides.getState().get(node.id)).toBeUndefined()
})
test('editing rights revoked before commit leave the scene unchanged and clear preview state', () => {
  const { wall, scene } = setup()
  const node = WallFeatureNode.parse({ face: 'a' })
  const session = createWallFeaturePlacementSession(node, scene)
  session.update({ wallId: wall.id, face: 'a', u: 2, elevation: 1.5 })
  useScene.setState({ readOnly: true })
  expect(session.commit()).toBeNull()
  expect(scene.get(node.id)).toBeUndefined()
  expect(useLiveNodeOverrides.getState().get(node.id)).toBeUndefined()
})

test('nested placement refuses a missing host or a cursor on another host face', () => {
  const { nodes, wall, other } = setup()
  const node = WallFeatureNode.parse({ face: 'a' })
  const bump = WallFeatureNode.parse({
    parentId: other.id,
    face: 'a',
    mode: 'bump',
    u: 2,
    width: 1,
    height: 1,
    depth: 0.2,
    bottom: 0,
  })
  nodes[bump.id] = bump
  expect(
    proposeWallFeature(nodes, node, {
      wallId: wall.id,
      face: 'a',
      u: 2,
      elevation: 0.5,
      bumpId: bump.id,
    }).placement,
  ).toBeNull()
  expect(
    proposeWallFeature(nodes, node, {
      wallId: wall.id,
      face: 'a',
      u: 2,
      elevation: 0.5,
      bumpId: 'wall-feature_missing',
    }).placement,
  ).toBeNull()
})

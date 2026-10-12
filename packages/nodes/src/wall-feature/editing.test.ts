import { afterEach, expect, test } from 'bun:test'
import {
  type AnyNode,
  createSceneApi,
  ItemNode,
  LevelNode,
  loadPlugin,
  nodeRegistry,
  resolveWallFeaturePlacement,
  sceneRegistry,
  subscribeSceneCommits,
  useLiveNodeOverrides,
  useScene,
  WallFeatureNode,
  WallNode,
} from '@pascal-app/core'
import {
  builtinPlugin,
  createWallFeaturePropertyPreview,
  hasDescendantHit,
  raycastWallFeature,
  wallFeatureEdit,
  wallFeatureHandles,
} from '@pascal-app/nodes'
import {
  BoxGeometry,
  DoubleSide,
  Group,
  type Intersection,
  Mesh,
  MeshBasicMaterial,
  Raycaster,
  Vector3,
} from 'three'

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
})
function setup() {
  const level = LevelNode.parse({ height: 3 })
  const wall = WallNode.parse({ parentId: level.id, start: [0, 0], end: [4, 0], thickness: 0.2 })
  const bump = WallFeatureNode.parse({
    parentId: wall.id,
    face: 'b',
    mode: 'bump',
    u: 1,
    bottom: 0.5,
    width: 1,
    height: 1,
    depth: 0.2,
  })
  const niche = WallFeatureNode.parse({
    parentId: bump.id,
    u: 0.2,
    bottom: 0.2,
    width: 0.4,
    height: 0.4,
    depth: 0.1,
  })
  wall.children = [bump.id]
  bump.children = [niche.id]
  level.children = [wall.id]
  const nodes: Record<string, AnyNode> = Object.fromEntries(
    [level, wall, bump, niche].map((n) => [n.id, n]),
  )
  useScene.setState({ nodes, dirtyNodes: new Set() })
  useScene.temporal.getState().resume()
  useScene.temporal.getState().clear()
  return { nodes, wall, bump, niche, scene: createSceneApi(useScene) }
}
test('mode conversion and face changes validate the entire hosted tree', () => {
  const { nodes, bump, niche } = setup()
  expect(() => wallFeatureEdit(nodes, bump, { mode: 'niche' })).toThrow()
  expect(() => wallFeatureEdit(nodes, bump, { width: 0.3 })).toThrow()
  expect(wallFeatureEdit(nodes, bump, { face: 'a' })).toEqual({ face: 'a' })
  expect(() => wallFeatureEdit(nodes, niche, { mode: 'bump' })).toThrow()
})
test('width and height grips keep the lower edges fixed; nested depth follows inherited face', () => {
  const { bump, niche, scene } = setup()
  const handles = wallFeatureHandles(bump, scene)
  expect(handles.map((handle) => handle.kind)).toEqual([
    'linear-resize',
    'linear-resize',
    'linear-resize',
    'linear-resize',
    'linear-resize',
  ])
  expect(handles.map((handle) => (handle.kind === 'linear-resize' ? handle.axis : null))).toEqual([
    'x',
    'y',
    'z',
    'x',
    'y',
  ])
  const width = handles[0]!
  const height = handles[1]!
  if (width.kind !== 'linear-resize' || height.kind !== 'linear-resize')
    throw Error('Missing handles')
  expect(width.anchor).toBe('min')
  expect(height.anchor).toBe('min')
  expect(width.apply(bump, 1.2, scene)).toEqual({ width: 1.2, u: 1.1 })
  expect(height.apply(bump, 1.2, scene)).toEqual({ height: 1.2 })
  const left = handles[3]!
  const bottom = handles[4]!
  if (left.kind !== 'linear-resize' || bottom.kind !== 'linear-resize')
    throw Error('Missing opposite-edge handles')
  expect(left.direction).toBe(-1)
  expect(bottom.direction).toBe(-1)
  expect(left.anchor).toBe('max')
  expect(bottom.anchor).toBe('max')
  const leftPatch = left.apply(bump, 1.2, scene)
  expect(leftPatch).toEqual({ width: 1.2, u: 0.9 })
  expect(leftPatch.u! + leftPatch.width! / 2).toBeCloseTo(bump.u + bump.width / 2)
  const bottomPatch = bottom.apply(bump, 1.2, scene)
  expect(bottomPatch.height).toBe(1.2)
  expect(bottomPatch.bottom).toBeCloseTo(0.3)
  expect(bottomPatch.bottom! + bottomPatch.height!).toBeCloseTo(bump.bottom + bump.height)
  const depth = wallFeatureHandles(niche, scene)[2]!
  if (depth.kind !== 'linear-resize') throw Error('Missing depth handle')
  expect(depth.dragAxis?.(niche, scene)).toEqual([0, 0, 1])
  useLiveNodeOverrides.getState().set(bump.id, { width: 1.2, u: 1.1 })
  expect(width.apply(bump, 20, scene)).toEqual({ width: 1.2, u: 1.1 })
})
test('inspector previews commit once and undo once; cancellation preserves unrelated overrides', () => {
  const { bump } = setup()
  const preview = createWallFeaturePropertyPreview(bump.id)
  let commits = 0
  const stop = subscribeSceneCommits(() => commits++)
  try {
    useLiveNodeOverrides.getState().set(bump.id, { name: 'Other preview' })
    preview.preview({ width: 1.1 })
    preview.preview({ width: 1.2 })
    expect(useScene.getState().nodes[bump.id]).toBe(bump)
    expect(commits).toBe(0)
    preview.commit()
    expect(commits).toBe(1)
    expect(useLiveNodeOverrides.getState().get(bump.id)).toEqual({ name: 'Other preview' })
    useScene.temporal.getState().undo()
    expect((useScene.getState().nodes[bump.id] as WallFeatureNode).width).toBe(1)
    preview.preview({ height: 1.3 })
    preview.cancel()
    expect(useLiveNodeOverrides.getState().get(bump.id)).toEqual({ name: 'Other preview' })
  } finally {
    stop()
  }
})
test('registered nested features and items outrank their host; passive helpers do not', async () => {
  if (!nodeRegistry.has('wall-feature')) await loadPlugin(builtinPlugin)
  const setupData = setup()
  const child = ItemNode.parse({
    parentId: setupData.niche.id,
    asset: {
      id: 'test',
      category: 'accessory',
      name: 'Object',
      thumbnail: '/thumb.webp',
      src: '/model.glb',
    },
  })
  useScene.setState({ nodes: { ...setupData.nodes, [child.id]: child } })
  const wall = new Group(),
    bump = new Group(),
    niche = new Group(),
    item = new Group(),
    helper = new Mesh()
  wall.add(bump)
  bump.add(niche, helper)
  niche.add(item)
  const registrations = [
    [setupData.wall.id, wall],
    [setupData.bump.id, bump],
    [setupData.niche.id, niche],
    [child.id, item],
  ] as const
  for (const [id, obj] of registrations) sceneRegistry.nodes.set(id, obj)
  try {
    expect(hasDescendantHit(wall, [{ object: niche }])).toBe(true)
    expect(hasDescendantHit(bump, [{ object: niche }])).toBe(true)
    expect(hasDescendantHit(niche, [{ object: item }])).toBe(true)
    expect(hasDescendantHit(bump, [{ object: helper }])).toBe(false)
  } finally {
    for (const [id] of registrations) sceneRegistry.nodes.delete(id)
  }
})
test('feature target raycasts the wall body and rejects hits outside its volume', () => {
  const { nodes, wall, bump } = setup()
  const placement = resolveWallFeaturePlacement(nodes, bump)
  const geometry = new BoxGeometry(1, 1, 0.2)
  geometry.translate(1.5, 1, -0.2)
  const material = new MeshBasicMaterial({ side: DoubleSide })
  const mesh = new Mesh(geometry, material)
  mesh.updateMatrixWorld(true)
  const target = new Mesh()
  const hits: Intersection[] = []
  try {
    raycastWallFeature(
      target,
      mesh,
      placement,
      new Raycaster(new Vector3(1.5, 1, -2), new Vector3(0, 0, 1)),
      hits,
    )
    expect(hits.length).toBeGreaterThan(0)
    expect(hits.every((hit) => hit.object === target)).toBe(true)
    const outside: Intersection[] = []
    raycastWallFeature(
      target,
      mesh,
      placement,
      new Raycaster(new Vector3(3, 1, -2), new Vector3(0, 0, 1)),
      outside,
    )
    expect(outside).toHaveLength(0)
  } finally {
    geometry.dispose()
    material.dispose()
  }
})

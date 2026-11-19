import { afterEach, beforeEach, expect, test } from 'bun:test'
import {
  type AnyNode,
  clearSceneHistory,
  type GeometryContext,
  getEffectiveNode,
  LawnNode,
  SiteNode,
  SlabNode,
  useLiveNodeOverrides,
  useScene,
} from '@pascal-app/core'
import { type BufferGeometry, Group, Mesh, Scene } from 'three'
import { createLawnBrushStroke } from './brush'
import { buildLawnGeometry } from './geometry'
import { lawnStrokeChunkCounts, updateLawnStrokeChunks } from './stroke-chunks'
import { LAWN_STROKE_REBUILD_MS, lawnGeometryKey } from './stroke-rebuild'

type Point = [number, number]
const rectangle = (x0: number, z0: number, x1: number, z1: number): Point[] => [
  [x0, z0],
  [x1, z0],
  [x1, z1],
  [x0, z1],
]
const bytes = (view: ArrayBufferView) =>
  new Uint8Array(view.buffer, view.byteOffset, view.byteLength)
let savedScene: ReturnType<typeof useScene.getState>
let savedOverrides: ReturnType<typeof useLiveNodeOverrides.getState>
beforeEach(() => {
  savedScene = useScene.getState()
  savedOverrides = useLiveNodeOverrides.getState()
  useLiveNodeOverrides.getState().clearAll()
  clearSceneHistory()
})
afterEach(() => {
  useScene.setState(savedScene)
  useLiveNodeOverrides.setState(savedOverrides)
  clearSceneHistory()
})

/** A lawn in the scene store, built and adopted by a scene group as the viewer does. */
function mounted(
  id: string,
  outline: Point[],
  props: Record<string, unknown> = {},
  paving: Point[][] = [],
) {
  const slabs = paving.map((polygon, index) =>
    SlabNode.parse({
      id: `slab_${id}${index}`,
      parentId: `site_${id}`,
      polygon,
      metadata: { flatwork: 'walk' },
    }),
  )
  const site = SiteNode.parse({
    id: `site_${id}`,
    children: [...slabs.map((slab) => slab.id), `lawn_${id}`],
    polygon: { type: 'polygon', points: outline },
  })
  const lawn = LawnNode.parse({ id: `lawn_${id}`, parentId: site.id, outline, seed: 19, ...props })
  useScene.setState({
    nodes: Object.fromEntries([site, ...slabs, lawn].map((node) => [node.id, node])),
    rootNodeIds: [site.id],
  })
  clearSceneHistory()
  const context = () => {
    const nodes: Record<string, AnyNode> = useScene.getState().nodes
    const resolve: GeometryContext['resolve'] = <N = AnyNode>(key: string) =>
      nodes[key] as N | undefined
    return { parent: site, sceneNodes: nodes, resolve }
  }
  const scene = new Scene()
  const group = new Group()
  scene.add(group)
  // The viewer asks for the key, then builds.
  const view = { built: lawnGeometryKey(lawn) }
  for (const child of [...buildLawnGeometry(lawn, context()).children]) group.add(child)
  const current = () => {
    const node = useScene.getState().nodes[lawn.id]
    if (node?.type !== 'lawn') throw new Error('Expected the lawn')
    return getEffectiveNode(node)
  }
  return { lawn, group, context, current, view }
}

function meshes(root: Group, prefix: string): Mesh[] {
  const found: Mesh[] = []
  root.traverse((object) => {
    if (object instanceof Mesh && object.name.startsWith(prefix)) found.push(object)
  })
  return found
}

/** What is drawn of the ground, triangle by triangle, whatever mesh carries it. */
function groundTriangles(root: Group): string[] {
  const records: string[] = []
  for (const mesh of meshes(root, 'lawn-ground')) {
    if (!mesh.visible) continue
    const geometry = mesh.geometry as BufferGeometry
    const index = geometry.getIndex()
    if (!index) continue
    const position = geometry.getAttribute('position'),
      color = geometry.getAttribute('color'),
      cover = geometry.getAttribute('lawnCover')
    for (let at = 0; at + 2 < Math.min(index.count, geometry.drawRange.count); at += 3) {
      const corners = [index.getX(at), index.getX(at + 1), index.getX(at + 2)]
      records.push(
        corners
          .map((corner) =>
            [
              position.getX(corner),
              position.getY(corner),
              position.getZ(corner),
              color.getX(corner),
              color.getY(corner),
              color.getZ(corner),
              cover ? cover.getX(corner) : 1,
            ].join(','),
          )
          .join('|'),
      )
    }
  }
  return records.sort()
}

/** The live group against a fresh full build of the same lawn: blades by chunk, ground, flowers. */
function expectEqualsFullBuild(view: ReturnType<typeof mounted>) {
  const full = new Group()
  for (const child of [...buildLawnGeometry(view.current(), view.context()).children])
    full.add(child)
  for (const prefix of ['lawn-blades-near-', 'lawn-blades-mid-']) {
    const live = new Map(meshes(view.group, prefix).map((mesh) => [mesh.name, mesh]))
    const wanted = meshes(full, prefix)
    expect([...live.keys()].sort()).toEqual(wanted.map((mesh) => mesh.name).sort())
    for (const mesh of wanted)
      for (const attribute of ['lawnRootHeight', 'lawnTraits'])
        expect(
          bytes(live.get(mesh.name)?.geometry.getAttribute(attribute).array as Float32Array),
        ).toEqual(bytes(mesh.geometry.getAttribute(attribute).array as Float32Array))
  }
  expect(groundTriangles(view.group)).toEqual(groundTriangles(full))
  const flowers = (root: Group) =>
    meshes(root, 'lawn-flowers')[0]?.geometry.getAttribute('position')
  const wanted = flowers(full)
  if (wanted)
    expect(bytes(flowers(view.group)?.array as Float32Array)).toEqual(
      bytes(wanted.array as Float32Array),
    )
}

const bare = { radiusM: 0.5, effect: 'bare', strength: 1 } as const
const path = Array.from({ length: 30 }, (_, index): Point => [-2 + index * 0.14, -1 + index * 0.08])

function paint(
  view: ReturnType<typeof mounted>,
  settings: Parameters<typeof createLawnBrushStroke>[1],
) {
  const untouched = new Map(
    meshes(view.group, 'lawn-blades-near-').map((mesh) => [mesh.name, mesh]),
  )
  const first = path[0]
  if (!first) throw new Error('A path has a first point')
  const saved = useScene.getState().nodes[view.lawn.id]
  if (saved?.type !== 'lawn') throw new Error('Expected the lawn')
  const stroke = createLawnBrushStroke(saved, settings, first)
  if (!stroke) throw new Error('Expected a stroke')
  // The lawn's system runs before the viewer asks for the key, in every frame.
  let key: string | undefined
  const counts: number[] = []
  let now = 0
  for (const point of [first, ...path.slice(1)]) {
    if (point !== first) expect(stroke.move(point)).toBe(true)
    now += 16
    updateLawnStrokeChunks(now)
    counts.push(lawnStrokeChunkCounts.get(view.lawn.id) ?? -1)
    for (const mesh of meshes(view.group, 'lawn-blades-near-'))
      if (untouched.get(mesh.name) !== mesh) untouched.delete(mesh.name)
    // The viewer is told to keep its build: no whole rebuild while the chunks follow the brush.
    key ??= lawnGeometryKey(view.lawn, now)
    expect(lawnGeometryKey(view.lawn, now)).toBe(key)
  }
  expect(key).toBe(view.view.built)
  return { stroke, counts, untouched, key, now }
}

test('a sample redraws only the chunks under the brush, on a 30 m2 and on a 2,000 m2 lawn', () => {
  const small = mounted('small', rectangle(-3, -2.5, 3, 2.5))
  const onSmall = paint(small, bare)
  expect(Math.max(...onSmall.counts)).toBeLessThanOrEqual(4)
  expect(Math.min(...onSmall.counts)).toBeGreaterThanOrEqual(1)
  expectEqualsFullBuild(small)
  onSmall.stroke.cancel()

  const large = mounted('large', rectangle(-20, -25, 20, 25))
  const chunks = meshes(large.group, 'lawn-blades-near-').length
  expect(chunks).toBeGreaterThan(20)
  const onLarge = paint(large, bare)
  // The same brush on the same path redraws the same few chunks, however large the lawn.
  expect(onLarge.counts).toEqual(onSmall.counts)
  // Every other chunk still draws the very buffers it had before the stroke.
  expect(onLarge.untouched.size).toBeGreaterThanOrEqual(chunks - 4)
  expectEqualsFullBuild(large)
  onLarge.stroke.cancel()
}, 60_000)

test('a released stroke is already the saved lawn: the viewer keeps it until the scene changes', () => {
  const view = mounted('release', rectangle(-10, -15, 10, 15), {
    strokes: [{ radiusM: 1, effect: 'shorter', strength: 1, points: [[4, 4]] }],
    flowers: [{ species: 'daisy', share: 1 }],
    flowerDensity: 0.6,
  })
  const painted = paint(view, { radiusM: 1.2, effect: 'taller', strength: 0.8 })
  expect(painted.stroke.commit()).toBe(true)
  expect(useScene.temporal.getState().pastStates).toHaveLength(1)
  expect(view.current().strokes).toHaveLength(2)
  // The frame after release: flowers are brought up to date at once, nothing is rebuilt whole.
  updateLawnStrokeChunks(painted.now + 16)
  expectEqualsFullBuild(view)
  expect(lawnGeometryKey(view.lawn, painted.now + 16)).toBe(painted.key)
  expect(lawnGeometryKey(view.lawn, painted.now + 32)).toBe(painted.key)
  // A second stroke starts from what the first one left mounted, and stays exact.
  const again = paint(view, bare)
  expect(again.key).toBe(view.view.built)
  expect(again.stroke.commit()).toBe(true)
  updateLawnStrokeChunks(again.now + 16)
  expectEqualsFullBuild(view)
  expect(lawnGeometryKey(view.lawn, again.now + 16)).toBe(painted.key)
  // A live preview of another edit, or any change of the scene, rebuilds as it always did.
  useLiveNodeOverrides.getState().set(view.lawn.id, { outline: rectangle(-9, -15, 10, 15) })
  const previewed = lawnGeometryKey(view.lawn, again.now + 48)
  expect(previewed).not.toBe(painted.key)
  useLiveNodeOverrides.getState().clear(view.lawn.id)
  useScene.temporal.getState().undo()
  expect(lawnGeometryKey(view.lawn, again.now + 64)).not.toBe(previewed)
  expect(view.current().strokes).toHaveLength(2)
}, 60_000)

test('flowers, thinned over the whole lawn, follow the brush as whole rebuilds spaced in time', () => {
  const view = mounted('flowers', rectangle(-10, -15, 10, 15), {
    flowers: [{ species: 'daisy', share: 1 }],
    flowerDensity: 0.6,
  })
  const before = meshes(view.group, 'lawn-flowers')[0]?.geometry
  const painted = paint(view, { radiusM: 1.5, effect: 'more-flowers', strength: 1 })
  // A pointer at rest: the next frame after the spacing brings the flowers up to date.
  updateLawnStrokeChunks(painted.now + LAWN_STROKE_REBUILD_MS * 100)
  expect(meshes(view.group, 'lawn-flowers')[0]?.geometry).not.toBe(before)
  expectEqualsFullBuild(view)
  painted.stroke.cancel()
}, 60_000)

test('a first bare stroke on an unpainted lawn shows soil under the brush and stays exact', () => {
  const view = mounted('soil', rectangle(-10, -15, 10, 15))
  const painted = paint(view, bare)
  expect(meshes(view.group, 'lawn-ground-').length).toBeGreaterThan(0)
  expectEqualsFullBuild(view)
  painted.stroke.cancel()
  updateLawnStrokeChunks(painted.now + 16)
  expect(lawnGeometryKey(view.lawn, painted.now + 16)).not.toBe(painted.key)
}, 60_000)

test('a stroke cancelled after a kept release rebuilds, and paving beside the brush stays clear', () => {
  const view = mounted('cancel', rectangle(-10, -15, 10, 15), {}, [
    rectangle(-2.4, -6, -1.6, 6),
    rectangle(-2, 0.4, 3, 1.1),
  ])
  const first = paint(view, bare)
  expectEqualsFullBuild(view)
  expect(first.stroke.commit()).toBe(true)
  updateLawnStrokeChunks(first.now + 16)
  expectEqualsFullBuild(view)
  expect(lawnGeometryKey(view.lawn, first.now + 16)).toBe(view.view.built)
  // The second stroke is dropped: what it drew must go, so the viewer is told to rebuild.
  const second = paint(view, { radiusM: 1, effect: 'taller', strength: 1 })
  second.stroke.cancel()
  updateLawnStrokeChunks(second.now + 16)
  expect(lawnGeometryKey(view.lawn, second.now + 16)).not.toBe(view.view.built)
  expect(view.current().strokes).toHaveLength(1)
}, 60_000)

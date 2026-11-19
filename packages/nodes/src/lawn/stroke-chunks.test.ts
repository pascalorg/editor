import { afterEach, beforeEach, expect, test } from 'bun:test'
import {
  type AnyNode,
  clearSceneHistory,
  type GeometryContext,
  getEffectiveNode,
  LawnNode,
  SiteNode,
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
function mounted(id: string, outline: Point[], props: Record<string, unknown> = {}) {
  const site = SiteNode.parse({
    id: `site_${id}`,
    children: [`lawn_${id}`],
    polygon: { type: 'polygon', points: outline },
  })
  const lawn = LawnNode.parse({ id: `lawn_${id}`, parentId: site.id, outline, seed: 19, ...props })
  useScene.setState({ nodes: { [site.id]: site, [lawn.id]: lawn }, rootNodeIds: [site.id] })
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
  lawnGeometryKey(lawn)
  for (const child of [...buildLawnGeometry(lawn, context()).children]) group.add(child)
  const current = () => {
    const node = useScene.getState().nodes[lawn.id]
    if (node?.type !== 'lawn') throw new Error('Expected the lawn')
    return getEffectiveNode(node)
  }
  return { lawn, group, context, current }
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
  const stroke = createLawnBrushStroke(view.lawn, settings, first)
  if (!stroke) throw new Error('Expected a stroke')
  const key = lawnGeometryKey(view.lawn, 0)
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
    expect(lawnGeometryKey(view.lawn, now)).toBe(key)
  }
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
})

test('what is drawn at release equals a full build, and the release then rebuilds once', () => {
  const view = mounted('release', rectangle(-10, -15, 10, 15), {
    strokes: [{ radiusM: 1, effect: 'shorter', strength: 1, points: [[4, 4]] }],
  })
  const painted = paint(view, { radiusM: 1.2, effect: 'taller', strength: 0.8 })
  expectEqualsFullBuild(view)
  expect(painted.stroke.commit()).toBe(true)
  updateLawnStrokeChunks(painted.now + 16)
  expect(lawnGeometryKey(view.lawn, painted.now + 16)).not.toBe(painted.key)
  expect(useScene.temporal.getState().pastStates).toHaveLength(1)
  expect(view.current().strokes).toHaveLength(2)
})

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
})

test('a first bare stroke on an unpainted lawn shows soil under the brush and stays exact', () => {
  const view = mounted('soil', rectangle(-10, -15, 10, 15))
  const painted = paint(view, bare)
  expect(meshes(view.group, 'lawn-ground-').length).toBeGreaterThan(0)
  expectEqualsFullBuild(view)
  painted.stroke.cancel()
  updateLawnStrokeChunks(painted.now + 16)
  expect(lawnGeometryKey(view.lawn, painted.now + 16)).not.toBe(painted.key)
})

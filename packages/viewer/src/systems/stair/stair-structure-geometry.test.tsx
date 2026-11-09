import { afterEach, expect, test } from 'bun:test'
import {
  resolveStairStringerLayout,
  resolveStairStructure,
  StairNode,
  StairSegmentNode,
  StairStructure,
  sceneRegistry,
  useLiveNodeOverrides,
  useScene,
} from '@pascal-app/core'
import ReactThreeTestRenderer from '@react-three/test-renderer'
import { BufferGeometry, Group, Mesh } from 'three'
import { StairSystem } from './stair-system'

const initialScene = useScene.getState()
const IN = 0.0254

afterEach(() => {
  useLiveNodeOverrides.getState().clearAll()
  sceneRegistry.clear()
  useScene.setState({
    nodes: initialScene.nodes,
    rootNodeIds: initialScene.rootNodeIds,
    dirtyNodes: initialScene.dirtyNodes,
  })
})

/** Draws one straight flight of eight 7 in risers over 11 in treads, 36 in wide, and returns its merged body. */
async function drawStair(structure: StairStructure | undefined) {
  const segment = StairSegmentNode.parse({
    id: 'sseg_structure',
    parentId: 'stair_structure',
    width: 36 * IN,
    height: 56 * IN,
    length: 88 * IN,
    stepCount: 8,
  })
  const stair = StairNode.parse({
    id: 'stair_structure',
    width: 36 * IN,
    children: [segment.id],
    totalRise: 56 * IN,
    stepCount: 8,
    structure,
  })
  const group = new Group()
  const body = new Mesh(new BufferGeometry())
  body.name = 'merged-stair'
  group.add(body)
  sceneRegistry.nodes.set(stair.id, group)
  sceneRegistry.nodes.set(segment.id, new Mesh(new BufferGeometry()))
  useScene.setState({
    nodes: { [stair.id]: stair, [segment.id]: segment },
    rootNodeIds: [stair.id],
    dirtyNodes: new Set([stair.id, segment.id]),
  } as never)
  const renderer = await ReactThreeTestRenderer.create(<StairSystem />)
  await renderer.advanceFrames(1, 1 / 60)
  const geometry = body.geometry
  geometry.computeBoundingBox()
  const xs = new Set<number>()
  const position = geometry.getAttribute('position')
  for (let i = 0; i < position.count; i++) xs.add(Math.round(position.getX(i) * 1e5) / 1e5)
  await renderer.unmount()
  return { stair, geometry, xs: [...xs] }
}

const near = (values: number[], target: number) =>
  values.some((value) => Math.abs(value - target) < 1e-4)

test('a wood-stringer stair shows its cut stringers at the computed places, above the floor it bears on', async () => {
  const { stair, geometry, xs } = await drawStair(StairStructure.parse({}))
  const layout = resolveStairStringerLayout(36 * IN, resolveStairStructure(stair)!)
  expect(layout.count).toBe(4)
  // both faces of every stringer are drawn where the layout puts them
  for (const band of layout.bands) {
    expect(near(xs, band.x0)).toBe(true)
    expect(near(xs, band.x1)).toBe(true)
  }
  const box = geometry.boundingBox!
  expect(box.min.y).toBeGreaterThanOrEqual(-1e-6)
  expect(box.max.y).toBeCloseTo(56 * IN, 5)
  // the nosing projects past the first riser
  expect(box.min.z).toBeCloseTo(-1 * IN, 5)
})

test('a concrete stair is one solid mass to the floor, and a stair without a structure keeps its body', async () => {
  const concrete = await drawStair(StairStructure.parse({ type: 'concrete' }))
  const layout = resolveStairStringerLayout(
    36 * IN,
    resolveStairStructure(StairNode.parse({ structure: {} }))!,
  )
  // no faces inside the width: no stringers
  expect(concrete.xs.every((x) => Math.abs(Math.abs(x) - 18 * IN) < 1e-4)).toBe(true)
  expect(near(concrete.xs, layout.bands[1]!.x0)).toBe(false)
  expect(concrete.geometry.boundingBox!.min.y).toBeCloseTo(0, 6)
  expect(concrete.geometry.boundingBox!.max.y).toBeCloseTo(56 * IN, 5)
  const legacy = await drawStair(undefined)
  expect(legacy.xs.every((x) => Math.abs(Math.abs(x) - 18 * IN) < 1e-4)).toBe(true)
  expect(legacy.geometry.boundingBox!.min.z).toBeCloseTo(0, 6)
})

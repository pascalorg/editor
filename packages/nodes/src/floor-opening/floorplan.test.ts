import { expect, test } from 'bun:test'
import {
  type AnyNodeId,
  FloorOpeningNode,
  type FloorplanGeometry,
  type GeometryContext,
  useLiveNodeOverrides,
  useScene,
} from '@pascal-app/core'
import {
  buildFloorOpeningFloorplan,
  floorOpeningMoveVertexAffordance,
  moveRectangleEdge,
  openingRectangle,
  resizeRectangleCorner,
} from './floorplan'

const opening = FloorOpeningNode.parse({
  polygon: [
    [0, 0],
    [2, 0],
    [2, 1],
    [0, 1],
  ],
})
const context = (selected: boolean) =>
  ({
    resolve: () => undefined,
    children: [],
    siblings: [],
    parent: null,
    viewState: { selected },
  }) as unknown as GeometryContext

const kinds = (geometry: FloorplanGeometry | null): string[] =>
  geometry?.kind === 'group' ? geometry.children.flatMap(kinds) : geometry ? [geometry.kind] : []

test('an opening draws as a dashed outline, with corner handles only while selected', () => {
  expect(kinds(buildFloorOpeningFloorplan(opening, context(false)))).toEqual(['path'])
  const selected = kinds(buildFloorOpeningFloorplan(opening, context(true)))
  expect(selected.filter((kind) => kind === 'endpoint-handle')).toHaveLength(4)
  expect(selected.filter((kind) => kind === 'edge-handle')).toHaveLength(4)
})

test('a stair opening stays a box: solid outline, side grips, corners and sides resize it square', () => {
  const rounded = FloorOpeningNode.parse({
    source: 'stair',
    ownerId: 'stair_box',
    // A legacy opening cut with rounded corners.
    polygon: [
      [0.1, 0],
      [1.9, 0],
      [2, 0.1],
      [2, 2.9],
      [1.9, 3],
      [0.1, 3],
      [0, 2.9],
      [0, 0.1],
    ],
  })
  const geometry = buildFloorOpeningFloorplan(rounded, context(true))
  const selected = kinds(geometry)
  expect(selected.filter((kind) => kind === 'midpoint-handle')).toHaveLength(0)
  expect(selected.filter((kind) => kind === 'edge-handle')).toHaveLength(4)
  // Four side grips and four corners.
  expect(selected.filter((kind) => kind === 'endpoint-handle')).toHaveLength(8)
  const box = openingRectangle(rounded.polygon)
  expect(box).toHaveLength(4)
  const xs = box.map(([x]) => x)
  const zs = box.map(([, z]) => z)
  expect([Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)]).toEqual([0, 2, 0, 3])
  const corner = box.findIndex(([x, z]) => x === 2 && z === 3)
  const grown = resizeRectangleCorner(box, corner, [2.5, 3.4])
  const square = (ring: [number, number][]) =>
    ring.every((a, i) => {
      const b = ring[(i + 1) % 4]!
      const c = ring[(i + 2) % 4]!
      return Math.abs((b[0] - a[0]) * (c[0] - b[0]) + (b[1] - a[1]) * (c[1] - b[1])) < 1e-9
    })
  expect(square(grown)).toBe(true)
  expect(grown).toContainEqual([2.5, 3.4])
  expect(grown).toContainEqual([0, 0])
  const edge = box.findIndex(([x], i) => x === 2 && box[(i + 1) % 4]![0] === 2)
  const wider = moveRectangleEdge(box, edge, 0.5)
  expect(square(wider)).toBe(true)
  expect(Math.max(...wider.map(([x]) => x))).toBeCloseTo(2.5)
  // Never collapses past the minimum side.
  expect(Math.max(...moveRectangleEdge(box, edge, -5).map(([x]) => x))).toBeCloseTo(0.2)
})

test("an elevator's opening keeps the free polygon handles", () => {
  const elevator = FloorOpeningNode.parse({ ...opening, source: 'elevator', ownerId: 'elevator_x' })
  const selected = kinds(buildFloorOpeningFloorplan(elevator, context(true)))
  expect(selected.filter((kind) => kind === 'midpoint-handle')).toHaveLength(4)
  expect(selected.filter((kind) => kind === 'endpoint-handle')).toHaveLength(4)
})

test('a stair opening drag previews live and writes the scene once, on release', () => {
  const stairOpening = FloorOpeningNode.parse({
    ...opening,
    id: 'floor-opening_drag',
    source: 'stair',
    ownerId: 'stair_drag',
  })
  const previous = useScene.getState()
  const frame = globalThis.requestAnimationFrame
  const cancelFrame = globalThis.cancelAnimationFrame
  globalThis.requestAnimationFrame = (() => 0) as typeof requestAnimationFrame
  globalThis.cancelAnimationFrame = () => {}
  useScene.setState({ nodes: { [stairOpening.id]: stairOpening } as never })
  let writes = 0
  const stop = useScene.subscribe((state, before) => {
    if (state.nodes !== before.nodes) writes++
  })
  try {
    const nodes = useScene.getState().nodes
    const session = floorOpeningMoveVertexAffordance.start({
      node: stairOpening,
      payload: { vertexIndex: 2 },
      nodes,
      initialPlanPoint: [2, 1],
    } as never)
    session.apply({ planPoint: [3, 2], modifiers: {} } as never)
    session.apply({ planPoint: [3, 1.5], modifiers: {} } as never)
    expect(writes).toBe(0)
    expect(useLiveNodeOverrides.getState().get(stairOpening.id)?.polygon).toContainEqual([3, 1.5])
    expect(session.canCommit()).toBe(true)
    session.commit?.()
    expect(writes).toBe(1)
    const written = useScene.getState().nodes[stairOpening.id as AnyNodeId] as FloorOpeningNode
    expect(written.polygon).toContainEqual([3, 1.5])
    expect(useLiveNodeOverrides.getState().get(stairOpening.id)).toBeUndefined()
  } finally {
    stop()
    useScene.setState({ nodes: previous.nodes })
    globalThis.requestAnimationFrame = frame
    globalThis.cancelAnimationFrame = cancelFrame
  }
})

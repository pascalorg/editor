import { expect, test } from 'bun:test'
import {
  type AnyNode,
  BuildingNode,
  containsPoint,
  LevelNode,
  measureStairHeadroom,
  resolveStairWalkingSurfaces,
  SlabNode,
  StairNode,
  StairSegmentNode,
  stairClearanceOpening,
  syncAutoStairOpenings,
} from '../../index'

test('headroom cuts follow tread heights and slab undersides while preserving authored holes', () => {
  const building = BuildingNode.parse({})
  const ground = LevelNode.parse({ parentId: building.id, level: 0, height: 3 })
  const upper = LevelNode.parse({ parentId: building.id, level: 1 })
  const flight = StairSegmentNode.parse({ height: 3, length: 5, stepCount: 15, fillToFloor: false })
  const stair = StairNode.parse({
    parentId: ground.id,
    fromLevelId: ground.id,
    toLevelId: upper.id,
    children: [flight.id],
    totalRise: 3,
    slabOpeningMode: 'destination',
  })
  const manual: [number, number][] = [
    [-3, -3],
    [-2, -3],
    [-2, -2],
    [-3, -2],
  ]
  const slab = SlabNode.parse({
    parentId: upper.id,
    elevation: 0,
    thickness: 0.2,
    polygon: [
      [-4, -4],
      [4, -4],
      [4, 8],
      [-4, 8],
    ],
    holes: [manual],
    holeMetadata: [{ source: 'manual' }],
  })
  const nodes: Record<string, AnyNode> = Object.fromEntries(
    [building, ground, upper, stair, { ...flight, parentId: stair.id }, slab].map((node) => [
      node.id,
      node,
    ]),
  )
  expect(resolveStairWalkingSurfaces(stair, nodes).at(-1)?.top).toBeCloseTo(3)
  expect(
    measureStairHeadroom(stair, nodes).obstructions.some((hit) => hit.nodeId === slab.id),
  ).toBe(true)
  const patch = syncAutoStairOpenings(nodes).find((update) => update.id === slab.id)!.data
  expect(patch.holes?.[0]).toEqual(manual)
  const cuts = patch.holes!.slice(1).map((outer) => ({ outer, holes: [] }))
  expect(containsPoint(cuts, [0, 1.2])).toBe(false)
  expect(containsPoint(cuts, [0, 1.5])).toBe(true)
  const opened = { ...nodes, [slab.id]: { ...slab, ...patch } }
  expect(measureStairHeadroom(stair, opened).obstructions).toHaveLength(0)
  expect(syncAutoStairOpenings(opened)).toHaveLength(0)
  const thicker = { ...nodes, [slab.id]: { ...slab, thickness: 0.8 } }
  const larger = syncAutoStairOpenings(thicker)
    .find((update) => update.id === slab.id)!
    .data.holes!.slice(1)
    .map((outer) => ({ outer, holes: [] }))
  expect(containsPoint(larger, [0, 0.5])).toBe(true)
})

test('repeated signed spiral turns measure the upper tread underside and preserve the centre of annular cuts', () => {
  for (const sign of [-1, 1]) {
    const stair = StairNode.parse({
      stairType: 'spiral',
      totalRise: 3,
      stepCount: 40,
      sweepAngle: sign * 4 * Math.PI,
      innerRadius: 0.4,
      width: 1,
      thickness: 0.05,
      showCenterColumn: false,
      topLandingMode: 'none',
    })
    const nodes = { [stair.id]: stair }
    const measured = measureStairHeadroom(stair, nodes)
    expect(measured.minimum).toBeCloseTo(1.45)
    expect(measured.obstructions.length).toBeGreaterThan(0)
    const withLanding = { ...stair, topLandingMode: 'integrated' as const }
    expect(measureStairHeadroom(withLanding, { [stair.id]: withLanding }).minimum!).toBeLessThan(
      measured.minimum!,
    )
    const cuts = stairClearanceOpening(stair, nodes, 2.8)!.map((outer) => ({ outer, holes: [] }))
    expect(containsPoint(cuts, [0, 0])).toBe(false)
    expect(containsPoint(cuts, [0.9, 0])).toBe(true)
  }
})

test('clearance queries preserve cuts and report incomplete coverage when effective counts exceed the query budget', () => {
  const building = BuildingNode.parse({})
  const ground = LevelNode.parse({ parentId: building.id, level: 0, height: 3 })
  const upper = LevelNode.parse({ parentId: building.id, level: 1 })
  const first = StairSegmentNode.parse({ height: 3, length: 5, stepCount: 15, fillToFloor: false })
  const second = StairSegmentNode.parse({ height: 3, length: 5, stepCount: 15, fillToFloor: false })
  const stair = StairNode.parse({
    parentId: ground.id,
    fromLevelId: ground.id,
    toLevelId: upper.id,
    totalRise: 6,
    children: [first.id, second.id],
    slabOpeningMode: 'destination',
  })
  const slab = SlabNode.parse({
    parentId: upper.id,
    elevation: 0,
    thickness: 0.2,
    polygon: [
      [-2, -2],
      [2, -2],
      [2, 12],
      [-2, 12],
    ],
  })
  const nodes: Record<string, AnyNode> = Object.fromEntries(
    [building, ground, upper, stair, first, second, slab].map((node) => [node.id, node]),
  )
  const patch = syncAutoStairOpenings(nodes).find((update) => update.id === slab.id)!.data
  const opened = { ...nodes, [slab.id]: { ...slab, ...patch } }
  const oversized = {
    ...opened,
    [first.id]: { ...first, stepCount: 10001 },
    [second.id]: { ...second, stepCount: -10001 },
  }
  expect(measureStairHeadroom(stair, oversized).status).toBe('unresolved')
  expect(() => resolveStairWalkingSurfaces(stair, oversized)).toThrow(RangeError)
  expect(syncAutoStairOpenings(oversized)).toHaveLength(0)
})

test('intermediate slab cuts stop above the floating body and hidden flights retain downstream chain transforms', () => {
  const first = StairSegmentNode.parse({
    height: 3,
    length: 5,
    stepCount: 15,
    fillToFloor: false,
    thickness: 0.25,
  })
  const second = StairSegmentNode.parse({
    height: 3,
    length: 5,
    stepCount: 15,
    fillToFloor: false,
    thickness: 0.25,
  })
  const stair = StairNode.parse({ totalRise: 6, children: [first.id, second.id] })
  const nodes: Record<string, AnyNode> = {
    [stair.id]: stair,
    [first.id]: first,
    [second.id]: second,
  }
  const cuts = stairClearanceOpening(stair, nodes, 2.8, 0, 3)!
  const end = Math.max(...cuts.flatMap((ring) => ring.map((point) => point[1])))
  // The sloped underside crosses the slab beyond the first upper tread.
  expect(end).toBeGreaterThan(5 + 5 / 15)
  expect(end).toBeLessThan(6)
  const surfaces = resolveStairWalkingSurfaces(stair, {
    ...nodes,
    [first.id]: { ...first, visible: false },
  })
  expect(surfaces[0]?.nodeId).toBe(second.id)
  expect(surfaces[0]?.walkingLine[0][2]).toBeCloseTo(5)
  expect(surfaces[0]?.top).toBeCloseTo(3.2)
})

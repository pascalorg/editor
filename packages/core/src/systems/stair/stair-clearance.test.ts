import { expect, test } from 'bun:test'
import {
  type AnyNode,
  BuildingNode,
  CeilingNode,
  clearSceneHistory,
  containsPoint,
  initSpaceDetectionSync,
  LevelNode,
  measureStairHeadroom,
  resolveStairWalkingSurfaces,
  runAsSingleSceneHistoryStep,
  SlabNode,
  StairNode,
  StairSegmentNode,
  stairClearanceOpening,
  syncAutoStairOpenings,
  useScene,
} from '../../index'
import { reconcileDocument, runSettlingDocument } from '../../runtime'
import { initializeStairOpeningSync } from './stair-opening-system'

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

test('a widened straight-flight opening stays a square-cornered rectangle', () => {
  const building = BuildingNode.parse({})
  const ground = LevelNode.parse({ parentId: building.id, level: 0, height: 3 })
  const upper = LevelNode.parse({ parentId: building.id, level: 1 })
  const flight = StairSegmentNode.parse({ height: 3, length: 4, stepCount: 15, width: 1 })
  const stair = StairNode.parse({
    parentId: ground.id,
    fromLevelId: ground.id,
    toLevelId: upper.id,
    children: [flight.id],
    totalRise: 3,
    slabOpeningMode: 'destination',
    openingOffset: 0.2,
  })
  const nodes: Record<string, AnyNode> = Object.fromEntries(
    [building, ground, upper, stair, { ...flight, parentId: stair.id }].map((node) => [
      node.id,
      node,
    ]),
  )
  const [ring, ...rest] = stairClearanceOpening(stair, nodes, 2.8, 0.2, 3)!
  expect(rest).toEqual([])
  expect(ring).toHaveLength(4)
  const xs = ring!.map(([x]) => x)
  expect(Math.min(...xs)).toBeCloseTo(-0.7)
  expect(Math.max(...xs)).toBeCloseTo(0.7)
  for (const [i, a] of ring!.entries()) {
    const b = ring![(i + 1) % 4]!
    const c = ring![(i + 2) % 4]!
    expect((b[0] - a[0]) * (c[0] - b[0]) + (b[1] - a[1]) * (c[1] - b[1])).toBeCloseTo(0)
  }
})

test.each(['updateNode', 'applyNodeChanges', 'reconcileDocument'] as const)(
  '%s moves a stair between surfaces without leaving its old automatic cutouts, in one undo step',
  async (path) => {
    const previousScene = useScene.getState()
    const previousCancel = globalThis.cancelAnimationFrame
    globalThis.cancelAnimationFrame = () => {}
    const previousFrame = globalThis.requestAnimationFrame
    globalThis.requestAnimationFrame = ((callback: FrameRequestCallback) => {
      callback(0)
      return 1
    }) as typeof requestAnimationFrame
    const building = BuildingNode.parse({ children: ['level_move_ground', 'level_move_upper'] })
    const ground = LevelNode.parse({
      id: 'level_move_ground',
      parentId: building.id,
      level: 0,
      height: 3,
    })
    const upper = LevelNode.parse({ id: 'level_move_upper', parentId: building.id, level: 1 })
    useScene.setState({
      nodes: { [building.id]: building, [ground.id]: ground, [upper.id]: upper },
      rootNodeIds: [building.id],
      dirtyNodes: new Set(),
      materials: {},
      collections: {},
      readOnly: false,
    })
    const stopStructure = initSpaceDetectionSync(useScene, {
      getState: () => ({ spaces: {}, setSpaces: () => {} }),
    })
    const stopStair = initializeStairOpeningSync()
    const settle = async () => {
      for (let i = 0; i < 4; i++) await Promise.resolve()
    }
    try {
      for (const [left, right] of [
        [0, 4],
        [4, 10],
      ] as const) {
        const polygon: [number, number][] = [
          [left, 0],
          [right, 0],
          [right, 8],
          [left, 8],
        ]
        useScene.getState().createNodes([
          {
            node: SlabNode.parse({ parentId: upper.id, polygon, elevation: 0, thickness: 0.2 }),
            parentId: upper.id,
          },
          {
            node: CeilingNode.parse({ parentId: ground.id, polygon, height: 3 }),
            parentId: ground.id,
          },
        ])
      }
      const segment = StairSegmentNode.parse({ length: 5, height: 3, width: 1, stepCount: 15 })
      const stair = StairNode.parse({
        parentId: ground.id,
        fromLevelId: ground.id,
        toLevelId: upper.id,
        position: [2, 0, 1],
        totalRise: 3,
        slabOpeningMode: 'destination',
        children: [segment.id],
      })
      useScene.getState().createNodes([
        { node: stair, parentId: ground.id },
        { node: { ...segment, parentId: stair.id }, parentId: stair.id },
      ])
      await settle()
      clearSceneHistory()
      const surfaces = () =>
        Object.values(useScene.getState().nodes).filter(
          (node): node is SlabNode | CeilingNode =>
            (node.type === 'slab' && node.parentId === upper.id) ||
            (node.type === 'ceiling' && node.parentId === ground.id),
        )
      const before = surfaces().map((node) => ({
        id: node.id,
        polygon: node.polygon,
        holes: node.holes,
      }))
      expect(before).toHaveLength(4)
      expect(before.filter((node) => node.holes.length === 1)).toHaveLength(2)
      const data = { position: [6, 0, 1] as [number, number, number] }
      if (path === 'updateNode') useScene.getState().updateNode(stair.id, data)
      else if (path === 'applyNodeChanges')
        useScene.getState().applyNodeChanges({ update: [{ id: stair.id, data }] })
      else
        runAsSingleSceneHistoryStep(useScene, () =>
          runSettlingDocument(useScene, () => {
            const beforeMove = useScene.getState().nodes
            useScene.getState().applyNodeChanges({ update: [{ id: stair.id, data }] })
            reconcileDocument(useScene, beforeMove)
          }),
        )
      await settle()
      for (const surface of surfaces()) {
        const openings = Object.values(useScene.getState().nodes).filter(
          (node) =>
            node.type === 'floor-opening' &&
            node.ownerId === stair.id &&
            node.parentId === surface.parentId,
        )
        expect(openings).toHaveLength(1)
        const atNewPosition = containsPoint([{ outer: surface.polygon, holes: [] }], [6, 4])
        expect(surface.holes).toHaveLength(atNewPosition ? 1 : 0)
        const shape = [{ outer: surface.polygon, holes: surface.holes }]
        if (atNewPosition) expect(containsPoint(shape, [6, 4])).toBe(false)
        else expect(containsPoint(shape, [2, 4])).toBe(true)
        expect(surface.polygon).toEqual(before.find((node) => node.id === surface.id)!.polygon)
      }
      expect(useScene.temporal.getState().pastStates).toHaveLength(1)
      useScene.temporal.getState().undo()
      await settle()
      expect(
        surfaces().map((node) => ({ id: node.id, polygon: node.polygon, holes: node.holes })),
      ).toEqual(before)
    } finally {
      stopStair()
      stopStructure()
      useScene.setState(previousScene)
      clearSceneHistory()
      globalThis.requestAnimationFrame = previousFrame
      globalThis.cancelAnimationFrame = previousCancel
    }
  },
)

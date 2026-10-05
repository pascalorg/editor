import { beforeEach, describe, expect, test } from 'bun:test'
import {
  type AnyNode,
  type AnyNodeDefinition,
  getFloorStackedPosition,
  nodeRegistry,
  registerNode,
  resolveStairTotalRise,
  type SlabNode,
  StairNode,
  StairSegmentNode,
  spatialGridManager,
} from '@pascal-app/core'
import { stairDefinition } from './definition'

/**
 * QA scene d0e27f8c0d19 (a hip ranch on a raised floor, the garage slab
 * dropped to the driveway): the nodes that decide where its three flights
 * stand, copied from the saved graph. The floor platform's walking surface is
 * 0.05, the garage slab's −0.566; the porch and the rear deck at 0.0246.
 */
const LEVEL_ID = 'level_ng7hzxv8pf6ll81a'
const PLATFORM_ID = 'slab_btc3dp7mfj5evv42'
const GARAGE_SLAB_ID = 'slab_gyck1c3q1bqtnsud'
const PORCH_ID = 'slab_v2ngw1b6eriw2pc7'

const PLATFORM_ELEVATION = 0.05
const GARAGE_ELEVATION = -0.566
const PORCH_ELEVATION = 0.0246

function slab(id: string, elevation: number, polygon: Array<[number, number]>): SlabNode {
  return {
    id,
    type: 'slab',
    object: 'node',
    parentId: LEVEL_ID,
    visible: true,
    metadata: {},
    children: [],
    polygon,
    holes: [],
    holeMetadata: [],
    elevation,
    thickness: 0.1016,
    autoFromWalls: false,
  } as unknown as SlabNode
}

const slabs = [
  slab(PLATFORM_ID, PLATFORM_ELEVATION, [
    [-8.5344, 0.3048],
    [-1.8288, 0.3048],
    [-1.8288, -6.4008],
    [8.5344, -6.4008],
    [8.5344, 6.4008],
    [-8.5344, 6.4008],
  ]),
  slab(GARAGE_SLAB_ID, GARAGE_ELEVATION, [
    [-8.5344, -6.4008],
    [-1.8288, -6.4008],
    [-1.8288, 0.3048],
    [-8.5344, 0.3048],
  ]),
  slab(PORCH_ID, PORCH_ELEVATION, [
    [-1.524, -6.492081],
    [3.3528, -6.492081],
    [3.3528, -8.625681],
    [-1.524, -8.625681],
  ]),
]

/** Garage steps: 4 risers from the garage slab up to the house door. */
function garageSteps(overrides: Partial<StairNode> = {}) {
  const flight = StairSegmentNode.parse({
    id: 'sseg_pjos7cqog2hefeph',
    parentId: 'stair_i455fhlb6j98t0ps',
    segmentType: 'stair',
    width: 1.0668,
    length: 1.1176,
    height: 0.616,
    stepCount: 4,
    attachmentSide: 'front',
    fillToFloor: true,
    thickness: 0.1016,
  })
  const stair = StairNode.parse({
    id: 'stair_i455fhlb6j98t0ps',
    parentId: LEVEL_ID,
    // as generated: the garage slab's own height written into the stair
    position: [-7.3152, GARAGE_ELEVATION, -0.8953],
    rotation: 0,
    stairType: 'straight',
    deckSlabId: PLATFORM_ID,
    width: 1.0668,
    totalRise: 0.616,
    stepCount: 4,
    thickness: 0.1016,
    fillToFloor: true,
    children: [flight.id],
    ...overrides,
  })
  return { stair, flight }
}

/** Porch steps: 3 risers from the grade in front of the porch up to its deck. */
function porchSteps() {
  const flight = StairSegmentNode.parse({
    id: 'sseg_514l9l10yc0vwk0n',
    parentId: 'stair_ujccatwhgl9od9jg',
    segmentType: 'stair',
    width: 1.524,
    length: 0.8382,
    height: 0.5274,
    stepCount: 3,
    attachmentSide: 'front',
    fillToFloor: false,
    thickness: 0.1016,
  })
  const stair = StairNode.parse({
    id: 'stair_ujccatwhgl9od9jg',
    parentId: LEVEL_ID,
    // the flight rests on bare ground and carries its grade
    position: [0.9144, -0.5028, -9.463881],
    rotation: 0,
    stairType: 'straight',
    deckSlabId: PORCH_ID,
    width: 1.524,
    totalRise: 0.5274,
    stepCount: 3,
    thickness: 0.1016,
    fillToFloor: false,
    children: [flight.id],
  })
  return { stair, flight }
}

function sceneWith(...parts: Array<{ stair: StairNode; flight: StairSegmentNode }>) {
  const level = {
    id: LEVEL_ID,
    type: 'level',
    object: 'node',
    parentId: null,
    visible: true,
    metadata: {},
    level: 0,
    baseElevation: 0,
    height: 2.7432,
    children: [...slabs.map((s) => s.id), ...parts.map((p) => p.stair.id)],
  } as unknown as AnyNode
  const nodes: Record<string, AnyNode> = { [LEVEL_ID]: level }
  for (const s of slabs) nodes[s.id] = s as AnyNode
  for (const { stair, flight } of parts) {
    nodes[stair.id] = stair as AnyNode
    nodes[flight.id] = flight as AnyNode
  }
  return nodes
}

/**
 * Where the 3D view draws the flight, level-local Y: the stair group sits at
 * the floor-stacked position (`StairSystem` → `syncStairGroupElevation`) and
 * the merged flight's step profile climbs `height / stepCount` per riser from
 * the group origin (`generateStairSegmentGeometry`).
 */
function renderedFlight(
  stair: StairNode,
  flight: StairSegmentNode,
  nodes: Record<string, AnyNode>,
) {
  const base = getFloorStackedPosition({
    node: stair as AnyNode,
    nodes,
    position: stair.position,
    rotation: stair.rotation,
  })[1]
  const riser = flight.height / flight.stepCount
  return {
    base,
    firstTread: base + riser,
    topTread: base + flight.height,
  }
}

describe('a flight standing on a dropped slab', () => {
  beforeEach(() => {
    nodeRegistry._reset()
    spatialGridManager.clear()
    registerNode(stairDefinition as unknown as AnyNodeDefinition)
    for (const s of slabs) spatialGridManager.handleNodeCreated(s as AnyNode, LEVEL_ID)
  })

  test('position[1] is a lift over the slab under it: the slab height written into it counts twice', () => {
    const steps = garageSteps()
    const nodes = sceneWith(steps)

    const flight = renderedFlight(steps.stair, steps.flight, nodes)

    // The floor-stack contract: base = position[1] + the surface it stands on.
    // With the garage slab's height already in position[1] that is the QA
    // capture — steps at −1.13 … −0.52, a garage drop (0.566) under the slab.
    expect(flight.base).toBeCloseTo(steps.stair.position[1] + GARAGE_ELEVATION, 6)
    expect(flight.base).toBeCloseTo(-1.132, 6)
    expect(flight.topTread).toBeCloseTo(-0.516, 6)
  })

  test('steps authored as a lift over the garage slab stand on it and land on the house floor', () => {
    const steps = garageSteps({
      position: [-7.3152, 0, -0.8953],
      supportSlabId: GARAGE_SLAB_ID,
    })
    const nodes = sceneWith(steps)

    const flight = renderedFlight(steps.stair, steps.flight, nodes)

    expect(flight.base).toBeCloseTo(GARAGE_ELEVATION, 6)
    expect(flight.firstTread).toBeCloseTo(GARAGE_ELEVATION + 0.616 / 4, 6)
    expect(flight.topTread).toBeCloseTo(PLATFORM_ELEVATION, 6)
  })

  test('the same base with no host pinned: the garage slab is the only surface under the flight', () => {
    const steps = garageSteps({ position: [-7.3152, 0, -0.8953] })
    const nodes = sceneWith(steps)

    expect(renderedFlight(steps.stair, steps.flight, nodes).base).toBeCloseTo(GARAGE_ELEVATION, 6)
  })

  test('the deck-derived rise measures from the base the 3D view stands the flight on', () => {
    const steps = garageSteps({
      position: [-7.3152, 0, -0.8953],
      supportSlabId: GARAGE_SLAB_ID,
      totalRise: undefined,
    })
    const nodes = sceneWith(steps)

    const base = renderedFlight(steps.stair, steps.flight, nodes).base
    const rise = resolveStairTotalRise(steps.stair, nodes)

    expect(rise).toBeCloseTo(0.616, 6)
    expect(base + rise).toBeCloseTo(PLATFORM_ELEVATION, 6)
  })

  test('porch steps on bare ground keep the grade they carry (no slab under them, no ground lift)', () => {
    const porch = porchSteps()
    const nodes = sceneWith(porch)

    const flight = renderedFlight(porch.stair, porch.flight, nodes)

    expect(flight.base).toBeCloseTo(-0.5028, 6)
    expect(flight.topTread).toBeCloseTo(PORCH_ELEVATION, 6)
  })
})

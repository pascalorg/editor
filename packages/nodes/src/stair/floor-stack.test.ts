import { beforeEach, describe, expect, test } from 'bun:test'
import {
  type AnyNode,
  type AnyNodeDefinition,
  getFloorPlacedElevation,
  getFloorStackedPosition,
  nodeRegistry,
  registerNode,
  resolveSupportSlabPatch,
  type SlabNode,
  StairNode,
  StairSegmentNode,
  spatialGridManager,
} from '@pascal-app/core'
import { stairDefinition } from './definition'
import { getStairFloorPlacedFootprints, getStairSegmentFloorPlacedFootprints } from './floor-stack'

const LEVEL_ID = 'level_test'

function makeLevel(): AnyNode {
  return {
    id: LEVEL_ID,
    type: 'level',
    object: 'node',
    parentId: null,
    visible: true,
    metadata: {},
    children: [],
    level: 0,
  } as AnyNode
}

function addSlab(polygon: Array<[number, number]>, elevation: number, id = `slab_${elevation}`) {
  const slab = {
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
    autoFromWalls: false,
  } as SlabNode
  spatialGridManager.handleNodeCreated(slab as AnyNode, LEVEL_ID)
}

describe('stair floor-stack footprints', () => {
  beforeEach(() => {
    nodeRegistry._reset()
    spatialGridManager.clear()
  })

  test('derives a rotated segment footprint from stair position and rotation', () => {
    const segment = StairSegmentNode.parse({
      id: 'sseg_single',
      width: 2,
      length: 4,
      height: 1,
      thickness: 0.25,
    })
    const stair = StairNode.parse({
      id: 'stair_single',
      parentId: LEVEL_ID,
      position: [10, 0, 20],
      rotation: Math.PI / 2,
      children: [segment.id],
    })

    const [footprint] = getStairSegmentFloorPlacedFootprints(stair, [segment])

    expect(footprint?.position?.[0]).toBeCloseTo(12)
    expect(footprint?.position?.[1]).toBeCloseTo(0)
    expect(footprint?.position?.[2]).toBeCloseTo(20)
    expect(footprint?.dimensions).toEqual([2, 1, 4])
    expect(footprint?.rotation[1]).toBeCloseTo(Math.PI / 2)
  })

  test('emits one footprint per chained stair segment', () => {
    const first = StairSegmentNode.parse({
      id: 'sseg_first',
      width: 2,
      length: 4,
      height: 1,
      thickness: 0.25,
    })
    const second = StairSegmentNode.parse({
      id: 'sseg_second',
      attachmentSide: 'left',
      width: 1.5,
      length: 3,
      height: 0.8,
      thickness: 0.2,
    })
    const stair = StairNode.parse({
      id: 'stair_multi',
      parentId: LEVEL_ID,
      position: [0, 0, 0],
      rotation: 0,
      children: [first.id, second.id],
    })

    const footprints = getStairSegmentFloorPlacedFootprints(stair, [first, second])

    expect(footprints).toHaveLength(2)
    expect(footprints[0]?.position).toEqual([0, 0, 2])
    expect(footprints[0]?.rotation[1]).toBeCloseTo(0)
    expect(footprints[1]?.position?.[0]).toBeCloseTo(2.5)
    expect(footprints[1]?.position?.[1]).toBeCloseTo(1)
    expect(footprints[1]?.position?.[2]).toBeCloseTo(2)
    expect(footprints[1]?.rotation[1]).toBeCloseTo(Math.PI / 2)
  })

  test('derives spiral footprints from the parent instead of retained straight segments', () => {
    const retainedSegment = StairSegmentNode.parse({
      id: 'sseg_retained_after_spiral_conversion',
      width: 1,
      length: 4,
      height: 2.8,
    })
    const spiral = StairNode.parse({
      id: 'stair_spiral_preset',
      parentId: LEVEL_ID,
      stairType: 'spiral',
      position: [3, 0, 4],
      innerRadius: 0.3,
      width: 1,
      stepCount: 12,
      sweepAngle: Math.PI * 2,
      children: [retainedSegment.id],
    })
    const footprints = getStairFloorPlacedFootprints(spiral, {
      [spiral.id]: spiral,
      [retainedSegment.id]: retainedSegment,
    })

    expect(footprints.length).toBeGreaterThanOrEqual(24)
    expect(
      footprints.some((footprint) => (footprint.position?.[0] ?? 0) < spiral.position[0]),
    ).toBe(true)
    expect(
      footprints.some((footprint) => (footprint.position?.[2] ?? 0) < spiral.position[2]),
    ).toBe(true)
  })

  test('keeps a columnless spiral center hole out of the support footprint', () => {
    registerNode(stairDefinition as unknown as AnyNodeDefinition)
    addSlab(
      [
        [-0.08, -0.08],
        [0.08, -0.08],
        [0.08, 0.08],
        [-0.08, 0.08],
      ],
      0.8,
      'slab_inside_spiral_hole',
    )

    const level = makeLevel()
    const spiral = StairNode.parse({
      id: 'stair_spiral_hole',
      parentId: LEVEL_ID,
      stairType: 'spiral',
      position: [0, 0, 0],
      innerRadius: 0.5,
      width: 0.8,
      stepCount: 16,
      showCenterColumn: false,
    })
    const footprints = getStairFloorPlacedFootprints(spiral, { [spiral.id]: spiral })

    expect(
      footprints.some((footprint) => {
        const position = footprint.position ?? spiral.position
        const radialDistance = Math.hypot(position[0], position[2])
        return radialDistance < spiral.innerRadius
      }),
    ).toBe(false)
    expect(
      getFloorPlacedElevation({
        node: spiral,
        nodes: { [level.id]: level, [spiral.id]: spiral },
        position: spiral.position,
        rotation: spiral.rotation,
        levelId: LEVEL_ID,
      }),
    ).toBeCloseTo(0)
  })

  test('uses the max slab elevation across stair segment footprints', () => {
    registerNode(stairDefinition as unknown as AnyNodeDefinition)

    addSlab(
      [
        [-0.6, 1.4],
        [0.6, 1.4],
        [0.6, 2.6],
        [-0.6, 2.6],
      ],
      0.25,
      'slab_low',
    )
    addSlab(
      [
        [2.2, 1.7],
        [2.8, 1.7],
        [2.8, 2.3],
        [2.2, 2.3],
      ],
      0.75,
      'slab_high',
    )

    const level = makeLevel()
    const first = StairSegmentNode.parse({
      id: 'sseg_resolver_first',
      width: 2,
      length: 4,
      height: 1,
    })
    const second = StairSegmentNode.parse({
      id: 'sseg_resolver_second',
      attachmentSide: 'left',
      width: 1.5,
      length: 3,
      height: 0.8,
    })
    const stair = StairNode.parse({
      id: 'stair_resolver',
      parentId: LEVEL_ID,
      position: [0, 0, 0],
      rotation: 0,
      children: [first.id, second.id],
    })
    const nodes = {
      [level.id]: level,
      [stair.id]: stair,
      [first.id]: first,
      [second.id]: second,
    }

    expect(
      getFloorPlacedElevation({
        node: stair,
        nodes,
        position: stair.position,
        rotation: stair.rotation,
        levelId: LEVEL_ID,
      }),
    ).toBeCloseTo(0.75)
  })

  test('persists the pointer-elected base across stacked slabs', () => {
    registerNode(stairDefinition as unknown as AnyNodeDefinition)

    const polygon: Array<[number, number]> = [
      [-2, -1],
      [2, -1],
      [2, 5],
      [-2, 5],
    ]
    addSlab(polygon, 0, 'slab_floor')
    addSlab(polygon, 0.8, 'slab_deck')

    const level = makeLevel()
    const segment = StairSegmentNode.parse({
      id: 'sseg_pointer_support',
      width: 1,
      length: 3,
      height: 2.8,
    })
    const stair = StairNode.parse({
      id: 'stair_pointer_support',
      parentId: LEVEL_ID,
      position: [0, 0, 0],
      rotation: 0,
      children: [segment.id],
    })
    const nodes = {
      [level.id]: level,
      [stair.id]: stair,
      [segment.id]: { ...segment, parentId: stair.id },
    }

    const underDeckPatch = resolveSupportSlabPatch(stair, nodes, { maxElevation: 0 })
    const onDeckPatch = resolveSupportSlabPatch(stair, nodes, { maxElevation: 0.8 })

    expect(underDeckPatch.supportSlabId).toBe('slab_floor')
    expect(onDeckPatch.supportSlabId).toBe('slab_deck')
    expect(
      getFloorStackedPosition({
        node: { ...stair, ...underDeckPatch },
        nodes,
        position: stair.position,
        rotation: stair.rotation,
      })[1],
    ).toBeCloseTo(0)
    expect(
      getFloorStackedPosition({
        node: { ...stair, ...onDeckPatch },
        nodes,
        position: stair.position,
        rotation: stair.rotation,
      })[1],
    ).toBeCloseTo(0.8)
  })

  test('elects a raised slab under a spiral preset footprint', () => {
    registerNode(stairDefinition as unknown as AnyNodeDefinition)

    addSlab(
      [
        [0.65, -0.35],
        [1.35, -0.35],
        [1.35, 0.35],
        [0.65, 0.35],
      ],
      0.8,
      'slab_under_spiral',
    )

    const level = makeLevel()
    const retainedSegment = StairSegmentNode.parse({
      id: 'sseg_spiral_support_retained',
      width: 0.4,
      length: 0.4,
      height: 2.8,
    })
    const spiral = StairNode.parse({
      id: 'stair_spiral_support',
      parentId: LEVEL_ID,
      stairType: 'spiral',
      position: [0, 0, 0],
      innerRadius: 0.3,
      width: 1,
      stepCount: 12,
      sweepAngle: Math.PI * 2,
      children: [retainedSegment.id],
    })
    const nodes = {
      [level.id]: level,
      [spiral.id]: spiral,
      [retainedSegment.id]: { ...retainedSegment, parentId: spiral.id },
    }

    expect(
      getFloorPlacedElevation({
        node: spiral,
        nodes,
        position: spiral.position,
        rotation: spiral.rotation,
        levelId: LEVEL_ID,
      }),
    ).toBeCloseTo(0.8)
  })
})

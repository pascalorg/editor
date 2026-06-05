import { beforeEach, describe, expect, test } from 'bun:test'
import {
  type AnyNode,
  type AnyNodeDefinition,
  getFloorPlacedElevation,
  nodeRegistry,
  registerNode,
  type SlabNode,
  StairNode,
  StairSegmentNode,
  spatialGridManager,
} from '@pascal-app/core'
import { stairDefinition } from './definition'
import { getStairSegmentFloorPlacedFootprints } from './floor-stack'

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
})

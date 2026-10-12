import { describe, expect, test } from 'bun:test'
import { type AnyNode, RoofSegmentNode, SlabNode } from '@pascal-app/core'
import { CANOPY_SNAP_REACH, getCanopySnapPoints, snapCanopyReach } from './canopy-snap'

const segment = RoofSegmentNode.parse({
  type: 'roof-segment',
  roofType: 'gable',
  width: 10,
  depth: 8,
  wallHeight: 0,
  pitch: 30,
  footprint: [
    [-5, -4],
    [5, -4],
    [5, 4],
    [-5, 4],
  ],
})

// a terrace slab in front of the +z wall, reaching 2 m out
const terrace = SlabNode.parse({
  type: 'slab',
  polygon: [
    [-3, 4],
    [3, 4],
    [3, 6],
    [-3, 6],
  ],
})

const nodes = { [segment.id]: segment, [terrace.id]: terrace } as unknown as Record<string, AnyNode>

describe('canopy snap', () => {
  // edge 2 runs [5,4] → [-5,4] and faces +z; its reach is its z
  const points = getCanopySnapPoints(segment, 2, nodes)

  test('a pulled edge near the terrace edge lands on it', () => {
    expect(snapCanopyReach(segment, 2, 5.9, points)).toBeCloseTo(6, 9)
    expect(snapCanopyReach(segment, 2, 6.15, points)).toBeCloseTo(6, 9)
  })

  test('beyond the snap reach the edge goes where it is pulled', () => {
    expect(snapCanopyReach(segment, 2, 6 + CANOPY_SNAP_REACH + 0.05, points)).toBeCloseTo(
      6 + CANOPY_SNAP_REACH + 0.05,
      9,
    )
  })

  test('the walls are a target too, so the edge can come back flush with them', () => {
    expect(snapCanopyReach(segment, 2, 4.1, points)).toBeCloseTo(4, 9)
  })
})

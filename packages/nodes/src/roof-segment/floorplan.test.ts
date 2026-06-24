import { describe, expect, test } from 'bun:test'
import type { RoofSegmentNode } from '@pascal-app/core'
import { getRoofSegmentPlanLinework } from './floorplan'

function dutchSegment(overrides: Partial<RoofSegmentNode> = {}): RoofSegmentNode {
  return {
    object: 'node',
    id: 'rseg_test',
    type: 'roof-segment',
    parentId: null,
    visible: true,
    metadata: {},
    position: [0, 0, 0],
    rotation: 0,
    roofType: 'dutch',
    width: 8,
    depth: 6,
    wallHeight: 2.5,
    pitch: 40,
    wallThickness: 0.1,
    deckThickness: 0.1,
    overhang: 0.3,
    shingleThickness: 0.05,
    gambrelLowerWidthRatio: 0.5,
    gambrelLowerHeightRatio: 0.6,
    mansardSteepWidthRatio: 0.15,
    mansardSteepHeightRatio: 0.7,
    dutchHipWidthRatio: 0.25,
    dutchHipHeightRatio: 0.5,
    children: [],
    ...overrides,
  } as RoofSegmentNode
}

describe('getRoofSegmentPlanLinework', () => {
  test('keeps dutch width-axis gable triangle on the waist', () => {
    const linework = getRoofSegmentPlanLinework(dutchSegment())

    expect(linework.ridges).toEqual([
      [
        [-2.5, 0],
        [2.5, 0],
      ],
    ])
    expect(linework.hips).toContainEqual([
      [-2.5, 1.5],
      [-2.5, 0],
    ])
    expect(linework.hips).toContainEqual([
      [2.5, 1.5],
      [2.5, 0],
    ])
  })

  test('keeps dutch depth-axis gable triangle on the waist when the depth exceeds the width', () => {
    const linework = getRoofSegmentPlanLinework(dutchSegment({ width: 6, depth: 8 }))

    expect(linework.ridges).toEqual([
      [
        [0, 2.5],
        [0, -2.5],
      ],
    ])
    expect(linework.hips).toContainEqual([
      [-1.5, 2.5],
      [0, 2.5],
    ])
    expect(linework.hips).toContainEqual([
      [1.5, -2.5],
      [0, -2.5],
    ])
  })
})

import { describe, expect, test } from 'bun:test'
import {
  getRoofSegmentDeckReach,
  getRoofSegmentVisibleTopBounds,
  RoofSegmentNode,
} from './roof-segment'

const COS_6_12 = Math.cos(Math.atan(0.5))

function segment(patch: Partial<RoofSegmentNode>): RoofSegmentNode {
  return RoofSegmentNode.parse({
    roofType: 'gable',
    width: 12,
    depth: 8,
    pitch: (Math.atan(0.5) * 180) / Math.PI,
    wallThickness: 0.2,
    overhang: 0.5,
    shingleThickness: 0,
    ...patch,
  })
}

describe('a roof segment deck reach', () => {
  test('without a gable overhang, every edge reaches as far as the eaves, in plan', () => {
    const reach = getRoofSegmentDeckReach(segment({}))
    expect(reach.z).toBeCloseTo(0.1 + 0.5 * COS_6_12, 9)
    expect(reach.x).toBeCloseTo(reach.z, 9)
  })

  test("a gable's, a gambrel's and a shed's ends reach their gable overhang past the walls' outside faces", () => {
    for (const roofType of ['gable', 'gambrel', 'shed'] as const) {
      const reach = getRoofSegmentDeckReach(segment({ roofType, gableOverhang: 0.9 }))
      expect(reach.x).toBeCloseTo(0.1 + 0.9, 9)
      expect(reach.z).toBeCloseTo(0.1 + 0.5 * COS_6_12, 9)
    }
    expect(getRoofSegmentDeckReach(segment({ gableOverhang: 0 })).x).toBeCloseTo(0.1, 9)
  })

  test('a hip, a flat roof and the other forms have no gable end: the field is inert', () => {
    for (const roofType of ['hip', 'flat', 'mansard', 'dutch'] as const) {
      const reach = getRoofSegmentDeckReach(segment({ roofType, gableOverhang: 0.9 }))
      expect(reach.x).toBeCloseTo(reach.z, 9)
    }
  })

  test('the visible top reaches the gable overhang at the ends and the eaves along the sides', () => {
    const bounds = getRoofSegmentVisibleTopBounds(segment({ gableOverhang: 0.9 }))
    expect(bounds.maxX).toBeCloseTo(6 + 0.1 + 0.9, 9)
    expect(bounds.minX).toBeCloseTo(-(6 + 0.1 + 0.9), 9)
    expect(bounds.maxZ).toBeCloseTo(4 + 0.1 + 0.5 * COS_6_12, 9)
  })
})

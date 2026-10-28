import { expect, test } from 'bun:test'
import {
  type AnyNode,
  type AnyNodeId,
  BuildingNode,
  FootingNode,
  footingDesign,
  LevelNode,
  SiteNode,
  SlabNode,
} from '@pascal-app/core'
import { footingDepthPatch, footingDepthReach, footingDepthShown } from './panel'

const IN = 0.0254

// Under a slab no depth is stored, and the field read 0 beside a bottom 8 in under grade.
test('the depth field reads how far under grade the bottom is poured', () => {
  expect(footingDepthShown({}, { gradeY: -0.05, bottomY: -0.25 })).toBeCloseTo(0.2, 9)
  expect(footingDepthShown({ depth: 0.3 }, { gradeY: 0, bottomY: -0.3 })).toBeCloseTo(0.3, 9)
  expect(footingDepthShown({ depth: 0.3 }, null)).toBe(0.3)
})

function house(foundation?: Record<string, unknown>) {
  const strip = FootingNode.parse({
    id: 'footing_strip',
    parentId: 'level_g',
    shape: 'strip',
    start: [2, 4],
    end: [8, 4],
  })
  const nodes = Object.fromEntries(
    [
      SiteNode.parse({ id: 'site_a', children: ['building_a'] }),
      BuildingNode.parse({
        id: 'building_a',
        parentId: 'site_a',
        children: ['level_g'],
        ...(foundation ? { metadata: { foundation } } : {}),
      }),
      LevelNode.parse({
        id: 'level_g',
        parentId: 'building_a',
        level: 0,
        children: ['slab_g', strip.id],
      }),
      SlabNode.parse({
        id: 'slab_g',
        parentId: 'level_g',
        plateRole: 'base',
        polygon: [
          [0, 0],
          [10, 0],
          [10, 8],
          [0, 8],
        ],
        elevation: 0.05,
        thickness: 0.05,
      }),
      strip,
    ].map((node) => [node.id, node]),
  ) as Record<AnyNodeId, AnyNode>
  return { nodes, strip }
}

// A depth shallower than the slab and the footing reach was stored and did nothing: the field
// snapped back and offered to clear it.
test('under a slab a depth only counts past what the slab and the footing reach', () => {
  const { nodes, strip } = house()
  const design = footingDesign(nodes, strip)!
  const reach = footingDepthReach(nodes, strip)
  expect(reach).toBeCloseTo(design.gradeY - design.bottomY, 9)
  expect(reach).toBeGreaterThan(4 * IN)
  expect(footingDepthPatch(4 * IN, reach, true)).toEqual({ depth: undefined })
  expect(footingDepthPatch(reach, reach, true)).toEqual({ depth: undefined })
  expect(footingDepthPatch(12 * IN, reach, true)).toEqual({ depth: 12 * IN })
  const deeper = { ...strip, depth: 12 * IN }
  expect(footingDepthShown(deeper, footingDesign(nodes, deeper))).toBeCloseTo(12 * IN, 6)
})

// Where no depth is the building's, a shallow one typed must be kept: dropping it poured the
// building's deeper one instead.
test('on piles the shallowest depth typed is poured, not the building’s', () => {
  const { nodes, strip } = house({
    enabled: true,
    type: 'raised',
    support: 'piles',
    footingDepthIn: 40,
  })
  const reach = footingDepthReach(nodes, strip)
  expect(reach).toBeGreaterThan(0)
  expect(reach).toBeLessThan(40 * IN)
  for (const typed of [reach, 2 * IN]) {
    const set = { ...strip, ...footingDepthPatch(typed, reach, false) }
    expect(footingDepthShown(set, footingDesign(nodes, set))).toBeCloseTo(reach, 6)
  }
})

test('under a raised floor a footing goes the depth typed under the crawl space’s dirt', () => {
  const { nodes, strip } = house({ enabled: true, type: 'raised', footingDepthIn: 40 })
  // Measured from the dug-out dirt, nothing takes it deeper than its own depth.
  const reach = footingDepthReach(nodes, strip)
  expect(reach).toBeCloseTo(0, 6)
  for (const typed of [6 * IN, 18 * IN]) {
    const set = { ...strip, ...footingDepthPatch(typed, reach, false) }
    expect(footingDepthShown(set, footingDesign(nodes, set))).toBeCloseTo(typed, 6)
  }
})

import { describe, expect, test } from 'bun:test'
import { defaultSectionMarkers } from './generate'
import type { NodeMap } from './model'

/**
 * A rectangular building 20 m east–west by 8 m north–south, with an extra
 * interior wall in the SOUTH half so the "look toward the heavier half" rule
 * has something to choose.
 */
function building(): NodeMap {
  return {
    level_0: { id: 'level_0', type: 'level', level: 0, children: [] },
    w_n: { id: 'w_n', type: 'wall', parentId: 'level_0', start: [0, 0], end: [20, 0] },
    w_e: { id: 'w_e', type: 'wall', parentId: 'level_0', start: [20, 0], end: [20, 8] },
    w_s: { id: 'w_s', type: 'wall', parentId: 'level_0', start: [20, 8], end: [0, 8] },
    w_w: { id: 'w_w', type: 'wall', parentId: 'level_0', start: [0, 8], end: [0, 0] },
    w_int: { id: 'w_int', type: 'wall', parentId: 'level_0', start: [2, 6], end: [18, 6] },
  }
}

describe('default section markers', () => {
  test('two cuts, labelled A and B, longitudinal first', () => {
    const cuts = defaultSectionMarkers(building())
    expect(cuts.map((c) => c.label)).toEqual(['A', 'B'])
    // The building is wider (20) than it is deep (8), so A runs along x.
    expect(cuts[0]?.start[1]).toBeCloseTo(cuts[0]?.end[1] ?? 0, 9)
    expect(cuts[1]?.start[0]).toBeCloseTo(cuts[1]?.end[0] ?? 0, 9)
  })

  test('both cuts pass through the centre of the wall footprint', () => {
    const [a, b] = defaultSectionMarkers(building())
    // Footprint is x 0..20, z 0..8 — centre (10, 4).
    expect(a?.start[1]).toBeCloseTo(4, 9)
    expect(b?.start[0]).toBeCloseTo(10, 9)
  })

  test('the cut line overhangs the building at both ends', () => {
    const [a, b] = defaultSectionMarkers(building())
    const margin = Math.max(1, 20 * 0.12) // 2.4 m
    expect(a?.start[0]).toBeCloseTo(-margin, 9)
    expect(a?.end[0]).toBeCloseTo(20 + margin, 9)
    expect(b?.start[1]).toBeCloseTo(-margin, 9)
    expect(b?.end[1]).toBeCloseTo(8 + margin, 9)
  })

  test('depth reaches the far face of the building plus the margin', () => {
    const [a, b] = defaultSectionMarkers(building())
    const margin = 2.4
    expect(a?.depth).toBeCloseTo(8 / 2 + margin, 6)
    expect(b?.depth).toBeCloseTo(20 / 2 + margin, 6)
  })

  test('the longitudinal cut looks toward the half carrying more wall', () => {
    // The interior wall sits at z = 6, i.e. SOUTH (+z) of the cut at z = 4, so
    // the +z half is heavier. Plan axes are x right / z down, so screen-left of
    // a +x cut is −z: the heavier +z half is 'right'.
    expect(defaultSectionMarkers(building())[0]?.lookDirection).toBe('right')
  })

  test('moving the extra wall to the north half flips the look direction', () => {
    const nodes = building()
    nodes.w_int = { id: 'w_int', type: 'wall', parentId: 'level_0', start: [2, 2], end: [18, 2] }
    expect(defaultSectionMarkers(nodes)[0]?.lookDirection).toBe('left')
  })

  test('a deeper-than-wide building puts the transverse cut first, still as A', () => {
    const nodes: NodeMap = {
      level_0: { id: 'level_0', type: 'level', level: 0, children: [] },
      w_n: { id: 'w_n', type: 'wall', parentId: 'level_0', start: [0, 0], end: [8, 0] },
      w_e: { id: 'w_e', type: 'wall', parentId: 'level_0', start: [8, 0], end: [8, 20] },
      w_s: { id: 'w_s', type: 'wall', parentId: 'level_0', start: [8, 20], end: [0, 20] },
      w_w: { id: 'w_w', type: 'wall', parentId: 'level_0', start: [0, 20], end: [0, 0] },
    }
    const cuts = defaultSectionMarkers(nodes)
    expect(cuts.map((c) => c.label)).toEqual(['A', 'B'])
    // A now runs along z (constant x), because z is the longer dimension.
    expect(cuts[0]?.start[0]).toBeCloseTo(cuts[0]?.end[0] ?? 0, 9)
  })

  test('both cuts are parented to the lowest level', () => {
    for (const cut of defaultSectionMarkers(building())) expect(cut.levelId).toBe('level_0')
  })

  test('a scene with no walls invents nothing', () => {
    expect(defaultSectionMarkers({ site_1: { id: 'site_1', type: 'site' } })).toEqual([])
  })

  test('a degenerate footprint invents nothing', () => {
    const nodes: NodeMap = {
      level_0: { id: 'level_0', type: 'level', level: 0, children: [] },
      w: { id: 'w', type: 'wall', parentId: 'level_0', start: [0, 0], end: [10, 0] },
    }
    // One wall has zero depth, so there is no transverse extent to cut.
    expect(defaultSectionMarkers(nodes)).toEqual([])
  })
})

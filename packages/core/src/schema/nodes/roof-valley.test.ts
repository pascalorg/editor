import { describe, expect, test } from 'bun:test'
import { RoofSegmentNode } from './roof-segment'
import { getOpenRoofValleys } from './roof-valley'

function segment(id: `rseg_${string}`, overrides: Partial<RoofSegmentNode> = {}): RoofSegmentNode {
  return RoofSegmentNode.parse({
    id,
    type: 'roof-segment',
    roofType: 'gable',
    width: 8,
    depth: 6,
    wallHeight: 3,
    pitch: 30,
    ...overrides,
  })
}

describe('getOpenRoofValleys', () => {
  test('creates valley pans where perpendicular gable segments overlap', () => {
    const main = segment('rseg_main')
    const wing = segment('rseg_wing', {
      position: [2.5, 0, 2.5],
      rotation: Math.PI / 2,
    })

    const valleys = getOpenRoofValleys([main, wing], 0.4)

    expect(valleys.length).toBeGreaterThan(0)
    for (const valley of valleys) {
      const length = Math.hypot(
        valley.end.x - valley.start.x,
        valley.end.y - valley.start.y,
        valley.end.z - valley.start.z,
      )
      expect(length).toBeGreaterThan(0.08)
      expect(valley.segmentIds).toEqual([main.id, wing.id])
      expect(valley.firstEdge[0].y).toBeFinite()
      expect(valley.secondEdge[1].y).toBeFinite()
    }
  })

  test('does not create a valley for disjoint segments', () => {
    const first = segment('rseg_first')
    const second = segment('rseg_second', { position: [20, 0, 0] })

    expect(getOpenRoofValleys([first, second])).toEqual([])
  })

  test('supports unequal pitches without assuming a 45 degree plan line', () => {
    const first = segment('rseg_first', { pitch: 22 })
    const second = segment('rseg_second', {
      pitch: 38,
      position: [2.5, 0, 2.5],
      rotation: Math.PI / 2,
    })

    const valleys = getOpenRoofValleys([first, second])

    expect(valleys.length).toBeGreaterThan(0)
    expect(
      valleys.some((valley) => {
        const dx = Math.abs(valley.end.x - valley.start.x)
        const dz = Math.abs(valley.end.z - valley.start.z)
        return Math.abs(dx - dz) > 0.05
      }),
    ).toBe(true)
  })

  test('creates valleys where a gable wing enters a mansard roof', () => {
    const mansard = segment('rseg_mansard', {
      roofType: 'mansard',
      width: 10,
      depth: 8,
      pitch: 30,
    })
    const gable = segment('rseg_gable', {
      width: 8,
      depth: 5,
      pitch: 35,
      position: [3, 0, 0],
      rotation: Math.PI / 2,
    })

    const valleys = getOpenRoofValleys([mansard, gable], 0.4)

    expect(valleys.length).toBe(5)
    expect(valleys.every((valley) => valley.segmentIds.includes(gable.id))).toBe(true)
  })

  test('creates valleys when an editor-sized gable wing enters a mansard roof', () => {
    const mansard = segment('rseg_mansard', {
      roofType: 'mansard',
      width: 8,
      depth: 10,
      wallHeight: 0.5,
      pitch: 40,
    })
    const gable = segment('rseg_gable', {
      width: 2.5,
      depth: 7,
      wallHeight: 0.5,
      pitch: 40,
      position: [3, 0, 0.75],
      rotation: Math.PI / 2,
    })

    expect(getOpenRoofValleys([mansard, gable], 0.35).length).toBeGreaterThan(0)
  })
})

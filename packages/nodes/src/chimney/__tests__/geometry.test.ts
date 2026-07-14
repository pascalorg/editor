import { describe, expect, test } from 'bun:test'
import { RoofSegmentNode } from '@pascal-app/core'
import { buildChimneyGeometry, flueXPositions } from '../geometry'
import { ChimneyNode } from '../schema'

const fixtureSegment = (): RoofSegmentNode =>
  RoofSegmentNode.parse({
    id: 'rseg_fixture',
    roofType: 'gable',
    width: 8,
    depth: 6,
    wallHeight: 2.5,
    // atan(2 / 3)° — gives getActiveRoofHeight ≈ 2.0 on this 8×6 gable.
    pitch: (Math.atan2(2, 3) * 180) / Math.PI,
    wallThickness: 0.1,
    deckThickness: 0.1,
    overhang: 0.3,
    shingleThickness: 0.05,
  })

describe('buildChimneyGeometry', () => {
  test('returns body for default chimney with a non-empty position attribute', () => {
    const { body, cap, flues, cricket } = buildChimneyGeometry(
      ChimneyNode.parse({}),
      fixtureSegment(),
    )
    expect(body.getAttribute('position').count).toBeGreaterThan(0)
    expect(cap?.getAttribute('position').count).toBeGreaterThan(0)
    expect(flues?.getAttribute('position').count).toBeGreaterThan(0)
    expect(cricket).toBeNull()
  })

  test('cap omitted when capShape=none', () => {
    const { cap } = buildChimneyGeometry(
      ChimneyNode.parse({ cap: true, capShape: 'none' }),
      fixtureSegment(),
    )
    expect(cap).toBeNull()
  })

  test('cap omitted when cap=false', () => {
    const { cap } = buildChimneyGeometry(ChimneyNode.parse({ cap: false }), fixtureSegment())
    expect(cap).toBeNull()
  })

  test('flues omitted when flueCount=0', () => {
    const { flues } = buildChimneyGeometry(ChimneyNode.parse({ flueCount: 0 }), fixtureSegment())
    expect(flues).toBeNull()
  })

  test('cricket only emitted for square body with non-none style', () => {
    const square = buildChimneyGeometry(
      ChimneyNode.parse({ cricketStyle: 'simple', bodyShape: 'square' }),
      fixtureSegment(),
    )
    expect(square.cricket?.getAttribute('position').count).toBeGreaterThan(0)

    const round = buildChimneyGeometry(
      ChimneyNode.parse({ cricketStyle: 'simple', bodyShape: 'round' }),
      fixtureSegment(),
    )
    expect(round.cricket).toBeNull()
  })

  test('shoulder style materially increases body vertex count for tapered/corbeled', () => {
    const none = buildChimneyGeometry(
      ChimneyNode.parse({ shoulderStyle: 'none' }),
      fixtureSegment(),
    ).body.getAttribute('position').count
    const tapered = buildChimneyGeometry(
      ChimneyNode.parse({ shoulderStyle: 'tapered' }),
      fixtureSegment(),
    ).body.getAttribute('position').count
    const corbeled = buildChimneyGeometry(
      ChimneyNode.parse({ shoulderStyle: 'corbeled' }),
      fixtureSegment(),
    ).body.getAttribute('position').count
    expect(tapered).toBeGreaterThan(none)
    expect(corbeled).toBeGreaterThan(tapered)
  })
})

describe('flueXPositions', () => {
  test('count=0 returns []', () => {
    expect(flueXPositions(0, 0.6, 0.22)).toEqual([])
  })
  test('count=1 returns [0]', () => {
    expect(flueXPositions(1, 0.6, 0.22)).toEqual([0])
  })
  test('count=4 spans the available width at spacing=1', () => {
    const xs = flueXPositions(4, 0.6, 0.1, 1)
    expect(xs.length).toBe(4)
    expect(xs[0]).toBeCloseTo(-(0.6 - 0.1) / 2)
    expect(xs[3]).toBeCloseTo((0.6 - 0.1) / 2)
  })
  test('spacing=0 collapses all to center', () => {
    const xs = flueXPositions(3, 0.6, 0.1, 0)
    expect(xs.every((x) => Math.abs(x) < 1e-6)).toBe(true)
  })
})

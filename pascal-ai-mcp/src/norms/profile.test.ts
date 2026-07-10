import { describe, expect, test } from 'bun:test'
import { DEFAULT_ROOM_AREAS } from '../layout-plan'
import { partitionLayout, scoreCandidate } from '../layout-partitioner'
import { validateLayoutPlan } from '../plan-validator'
import { DEFAULT_NORM_PROFILE, JP_NORM_PROFILE, quantizeAreaSqm, resolveNormProfile } from './profile'

describe('resolveNormProfile', () => {
  test('resolves known ids and falls back to default for unknown/unset', () => {
    expect(resolveNormProfile('jp')).toBe(JP_NORM_PROFILE)
    expect(resolveNormProfile('default')).toBe(DEFAULT_NORM_PROFILE)
    expect(resolveNormProfile('nope')).toBe(DEFAULT_NORM_PROFILE)
    expect(resolveNormProfile(undefined)).toBe(DEFAULT_NORM_PROFILE)
  })
})

describe('default profile is the regression baseline', () => {
  test('carries the pre-S0 hardcoded partitioner values verbatim', () => {
    expect(DEFAULT_NORM_PROFILE.partition).toEqual({
      corridorWidthM: 1.15,
      maxRoomAspect: 3.0,
      maxFootprintAspect: 2.2,
      maxFootprintAspectNarrowLot: 4.0,
      minDoorEdgeM: 0.9,
      minRoomWidthSmallM: 1.5,
      minRoomWidthDefaultM: 1.8,
      carveablePublicMaxSqm: 9,
    })
    expect(DEFAULT_NORM_PROFILE.defaultRoomAreas).toBe(DEFAULT_ROOM_AREAS)
  })

  test('partitionLayout with an explicit default profile equals the no-arg call', () => {
    const intent = {
      targetTotalAreaSqm: 70,
      rooms: [
        { id: 'living-1', name: '客厅', type: 'living' as const },
        { id: 'bedroom-1', name: '主卧', type: 'bedroom' as const },
        { id: 'bedroom-2', name: '次卧', type: 'bedroom' as const },
        { id: 'kitchen-1', name: '厨房', type: 'kitchen' as const },
        { id: 'bathroom-1', name: '卫生间', type: 'bathroom' as const },
      ],
    }
    expect(partitionLayout(intent, DEFAULT_NORM_PROFILE)).toEqual(partitionLayout(intent))
  })
})

describe('jp profile', () => {
  test('corridor design width stays above the J4 fatal floor', () => {
    expect(JP_NORM_PROFILE.partition.corridorWidthM).toBe(0.91)
    expect(JP_NORM_PROFILE.partition.corridorWidthM).toBeGreaterThanOrEqual(0.78)
  })

  test('default room areas are 帖-derived (1帖 = 1.62㎡)', () => {
    expect(JP_NORM_PROFILE.defaultRoomAreas.bedroom).toBeCloseTo(6 * 1.62, 2)
    expect(JP_NORM_PROFILE.defaultRoomAreas.living_kitchen).toBeCloseTo(16 * 1.62, 2)
    expect(JP_NORM_PROFILE.defaultRoomAreas.entry).toBeCloseTo(1.5 * 1.62, 2)
  })

  test('J7 quantization snaps areas to 0.25帖 and is off by default', () => {
    expect(quantizeAreaSqm(10, null)).toBe(10)
    // 10 / (1.62×0.25) = 24.69 → 25 steps → 10.125㎡
    expect(quantizeAreaSqm(10, JP_NORM_PROFILE.areaQuantization)).toBeCloseTo(10.125, 3)
    // Never quantizes to zero.
    expect(quantizeAreaSqm(0.05, JP_NORM_PROFILE.areaQuantization)).toBeCloseTo(0.405, 3)
    expect(DEFAULT_NORM_PROFILE.areaQuantization).toBeNull()
  })

  test('LDK fatal minimum steps up at 2+ bedrooms (不動産表示規約)', () => {
    const one = JP_NORM_PROFILE.roomAreaBounds({ totalAreaSqm: 40, bedroomCount: 1 })
    const two = JP_NORM_PROFILE.roomAreaBounds({ totalAreaSqm: 60, bedroomCount: 2 })
    expect(one.living!.fatalMin).toBeCloseTo(8 * 1.62, 2)
    expect(two.living!.fatalMin).toBeCloseTo(10 * 1.62, 2)
  })

  test('validator flags an undersized LDK under jp but not under default', () => {
    const intent = {
      targetTotalAreaSqm: 45,
      rooms: [
        { id: 'living-1', name: 'LDK', type: 'living_kitchen' as const, targetAreaSqm: 13 },
        { id: 'bedroom-1', name: '洋室1', type: 'bedroom' as const, targetAreaSqm: 10 },
        { id: 'bedroom-2', name: '洋室2', type: 'bedroom' as const, targetAreaSqm: 10 },
        { id: 'bathroom-1', name: '浴室', type: 'bathroom' as const, targetAreaSqm: 4 },
      ],
    }
    const partition = partitionLayout(intent)
    expect(partition.ok).toBe(true)
    if (!partition.ok) return
    const underDefault = validateLayoutPlan(partition.plan, {}, DEFAULT_NORM_PROFILE)
    const underJp = validateLayoutPlan(partition.plan, {}, JP_NORM_PROFILE)
    expect(underDefault.fatal.filter(f => f.includes('合理区间'))).toEqual([])
    expect(underJp.fatal.some(f => f.includes('LDK') && f.includes('合理区间'))).toBe(true)
  })

  test('partitioner honours the jp corridor width', () => {
    const intent = {
      targetTotalAreaSqm: 70,
      rooms: [
        { id: 'ldk-1', name: 'LDK', type: 'living_kitchen' as const },
        { id: 'bedroom-1', name: '洋室1', type: 'bedroom' as const },
        { id: 'bedroom-2', name: '洋室2', type: 'bedroom' as const },
        { id: 'bathroom-1', name: '浴室', type: 'bathroom' as const },
      ],
    }
    const result = partitionLayout(intent, JP_NORM_PROFILE)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const corridor = result.plan.rooms.find(room => room.type === 'hallway')
    expect(corridor).toBeDefined()
    const zs = corridor!.polygon.map(([, z]) => z)
    expect(Math.max(...zs) - Math.min(...zs)).toBeCloseTo(0.91, 2)
  })
})

describe('scoreCandidate', () => {
  test('reproduces the pre-S2 hardcoded penalty formula under default scoring', () => {
    const s = DEFAULT_NORM_PROFILE.scoring
    // footprint 8×6.4 (aspect 1.25), one room at 2.7:1, corridor 18%.
    const penalty = scoreCandidate(
      { footprintW: 8, footprintD: 6.4, roomAspects: [2.7, 1.4], corridorRatio: 0.18 },
      s,
    )
    const expected = Math.abs(1.25 - 1.35) * 6 + (2.7 - 2.2) * 8 + (0.18 - 0.15) * 120
    expect(penalty).toBeCloseTo(expected, 6)
  })

  test('weights actually steer the score', () => {
    const base = { footprintW: 10, footprintD: 5, roomAspects: [], corridorRatio: 0.3 }
    const light = scoreCandidate(base, { ...DEFAULT_NORM_PROFILE.scoring, corridorShareExcessWeight: 0 })
    const heavy = scoreCandidate(base, { ...DEFAULT_NORM_PROFILE.scoring, corridorShareExcessWeight: 500 })
    expect(heavy).toBeGreaterThan(light)
  })
})

import { describe, expect, test } from 'bun:test'
import { issueText, type Lang } from './lang/i18n'
import type { LayoutIntent } from './layout-plan'
import { DEFAULT_NORM_PROFILE, JP_NORM_PROFILE } from './norms/profile'
import { buildLayoutPlan } from './plan-builder'
import {
  applyStrategy,
  areaBandOf,
  deriveBriefFacts,
  deriveStrategy,
  strategyPromptLines,
} from './strategy'
import type { ChatMessage } from './types'

describe('areaBandOf', () => {
  test('cutoffs at 25 / 45 / 70 ㎡ (design doc §3.1)', () => {
    expect(areaBandOf(20)).toBe('tiny')
    expect(areaBandOf(25)).toBe('compact')
    expect(areaBandOf(44.9)).toBe('compact')
    expect(areaBandOf(45)).toBe('standard')
    expect(areaBandOf(70)).toBe('large')
    expect(areaBandOf(undefined)).toBe('standard')
  })
})

describe('deriveBriefFacts', () => {
  test('detects explicit kitchen preference in all three languages', () => {
    expect(deriveBriefFacts('35㎡ 一居室，开放式厨房')).toEqual({ kitchenPreference: 'open' })
    expect(deriveBriefFacts('2LDKでお願いします')).toEqual({ kitchenPreference: 'open' })
    expect(deriveBriefFacts('a studio with an open kitchen')).toEqual({ kitchenPreference: 'open' })
    expect(deriveBriefFacts('70㎡ 两室，要独立厨房')).toEqual({ kitchenPreference: 'closed' })
    expect(deriveBriefFacts('独立キッチンの2部屋')).toEqual({ kitchenPreference: 'closed' })
    expect(deriveBriefFacts('two bedrooms with a separate kitchen')).toEqual({ kitchenPreference: 'closed' })
    expect(deriveBriefFacts('三室一厅')).toEqual({})
  })

  test('closed wins when the brief says both', () => {
    expect(deriveBriefFacts('开放式厨房改成独立厨房')).toEqual({ kitchenPreference: 'closed' })
  })

  test('detects lot dimensions in all three languages (S3)', () => {
    expect(deriveBriefFacts('地块为长方形，宽 5 米、长 18 米').siteHint).toEqual({ widthM: 5, depthM: 18 })
    expect(deriveBriefFacts('5米x18米的狭长地块').siteHint).toEqual({ widthM: 5, depthM: 18 })
    expect(deriveBriefFacts('a lot of 5m × 18m').siteHint).toEqual({ widthM: 5, depthM: 18 })
    expect(deriveBriefFacts('the site is 5 m wide and 18 m long').siteHint).toEqual({ widthM: 5, depthM: 18 })
    expect(deriveBriefFacts('間口5m、奥行18mの敷地').siteHint).toEqual({ widthM: 5, depthM: 18 })
    // No unit anywhere — not dimensions.
    expect(deriveBriefFacts('3x2 bedrooms please').siteHint).toBeUndefined()
  })

  test('detects explicit narrow-lot wording without dimensions (S3)', () => {
    expect(deriveBriefFacts('狭长地块，两室一厅').narrowLot).toBe(true)
    expect(deriveBriefFacts('うなぎの寝床のような敷地').narrowLot).toBe(true)
    expect(deriveBriefFacts('a narrow lot in town').narrowLot).toBe(true)
    expect(deriveBriefFacts('普通两居室').narrowLot).toBeUndefined()
  })
})

describe('deriveStrategy', () => {
  test('kitchen mode: user wording beats band defaults', () => {
    const small = deriveStrategy({}, { totalAreaSqm: 35 }, DEFAULT_NORM_PROFILE)
    expect(small.kitchenMode).toBe('open')
    expect(small.kitchenModeSource).toBe('band_default')

    const big = deriveStrategy({}, { totalAreaSqm: 75 }, DEFAULT_NORM_PROFILE)
    expect(big.kitchenMode).toBe('closed')

    const override = deriveStrategy({ kitchenPreference: 'closed' }, { totalAreaSqm: 35 }, DEFAULT_NORM_PROFILE)
    expect(override.kitchenMode).toBe('closed')
    expect(override.kitchenModeSource).toBe('user')
  })

  test('typology is studio only for a single required room', () => {
    expect(deriveStrategy({}, {
      totalAreaSqm: 20,
      requiredRooms: [{ type: 'living', count: 1 }],
    }, DEFAULT_NORM_PROFILE).typology).toBe('studio')
    // 2 bedrooms at standard band → 田の字 preference (S4).
    expect(deriveStrategy({}, {
      totalAreaSqm: 55,
      requiredRooms: [{ type: 'bedroom', count: 2 }],
    }, DEFAULT_NORM_PROFILE).typology).toBe('tanoji')
    // Unknown room list stays on the safe default.
    expect(deriveStrategy({}, { totalAreaSqm: 55 }, DEFAULT_NORM_PROFILE).typology).toBe('standard_band')
  })

  test('kitchen scope: bedrooms-only brief keeps the kitchen line out of the prompt (case-12)', () => {
    const bedroomsOnly = deriveStrategy({}, {
      totalAreaSqm: 50,
      requiredRooms: [{ type: 'bedroom', count: 2 }],
    }, DEFAULT_NORM_PROFILE)
    expect(bedroomsOnly.kitchenInScope).toBe(false)
    expect(strategyPromptLines(bedroomsOnly)).not.toContain('厨房模式')
    expect(bedroomsOnly.notes.join()).toContain('不注入')

    // No explicit room list → full-home assumption keeps the guidance.
    const noList = deriveStrategy({}, { totalAreaSqm: 50 }, DEFAULT_NORM_PROFILE)
    expect(noList.kitchenInScope).toBe(true)
    expect(strategyPromptLines(noList)).toContain('厨房模式')

    // Kitchen in the room list → in scope.
    const withKitchen = deriveStrategy({}, {
      totalAreaSqm: 50,
      requiredRooms: [{ type: 'bedroom', count: 2 }, { type: 'kitchen', count: 1 }],
    }, DEFAULT_NORM_PROFILE)
    expect(withKitchen.kitchenInScope).toBe(true)

    // User preference pulls the kitchen into scope even off-list.
    const userPref = deriveStrategy({ kitchenPreference: 'open' }, {
      totalAreaSqm: 50,
      requiredRooms: [{ type: 'bedroom', count: 2 }],
    }, DEFAULT_NORM_PROFILE)
    expect(userPref.kitchenInScope).toBe(true)
  })

  test('narrow_lot typology (S3): siteHint aspect > 2.2 or explicit wording', () => {
    const rooms = [
      { type: 'bedroom', count: 2 },
      { type: 'living', count: 1 },
    ]
    const withHint = deriveStrategy(
      { siteHint: { widthM: 5, depthM: 18 } },
      { totalAreaSqm: 90, requiredRooms: rooms },
      DEFAULT_NORM_PROFILE,
    )
    expect(withHint.typology).toBe('narrow_lot')
    expect(withHint.footprintHint).toEqual({ widthM: 5, depthM: 18 })

    // Aspect 1.2 — an ordinary lot; 2 bedrooms at large band falls through
    // to the 田の字 preference (S4), never narrow_lot.
    const square = deriveStrategy(
      { siteHint: { widthM: 10, depthM: 12 } },
      { totalAreaSqm: 90, requiredRooms: rooms },
      DEFAULT_NORM_PROFILE,
    )
    expect(square.typology).toBe('tanoji')
    expect(square.footprintHint).toBeUndefined()

    // Keyword only: narrow_lot without a footprint hint.
    const keyword = deriveStrategy(
      { narrowLot: true },
      { totalAreaSqm: 90, requiredRooms: rooms },
      DEFAULT_NORM_PROFILE,
    )
    expect(keyword.typology).toBe('narrow_lot')
    expect(keyword.footprintHint).toBeUndefined()

    // A single-room brief stays studio even on a slender lot.
    const single = deriveStrategy(
      { siteHint: { widthM: 4, depthM: 12 } },
      { totalAreaSqm: 30, requiredRooms: [{ type: 'living', count: 1 }] },
      DEFAULT_NORM_PROFILE,
    )
    expect(single.typology).toBe('studio')
  })

  test('tanoji rule (S4): 2–3 bedrooms at standard/large band, others untouched', () => {
    const beds = (count: number) => [{ type: 'bedroom', count }, { type: 'living_kitchen', count: 1 }]
    expect(deriveStrategy({}, { totalAreaSqm: 60, requiredRooms: beds(2) }, DEFAULT_NORM_PROFILE).typology).toBe('tanoji')
    expect(deriveStrategy({}, { totalAreaSqm: 80, requiredRooms: beds(3) }, DEFAULT_NORM_PROFILE).typology).toBe('tanoji')
    // compact band / 1 bedroom / 4 bedrooms stay standard_band.
    expect(deriveStrategy({}, { totalAreaSqm: 40, requiredRooms: beds(2) }, DEFAULT_NORM_PROFILE).typology).toBe('standard_band')
    expect(deriveStrategy({}, { totalAreaSqm: 60, requiredRooms: beds(1) }, DEFAULT_NORM_PROFILE).typology).toBe('standard_band')
    expect(deriveStrategy({}, { totalAreaSqm: 90, requiredRooms: beds(4) }, DEFAULT_NORM_PROFILE).typology).toBe('standard_band')
    // Site constraints outrank the preference.
    expect(deriveStrategy({ narrowLot: true }, { totalAreaSqm: 60, requiredRooms: beds(2) }, DEFAULT_NORM_PROFILE).typology).toBe('narrow_lot')
    expect(deriveStrategy({ lShape: true }, { totalAreaSqm: 60, requiredRooms: beds(2) }, DEFAULT_NORM_PROFILE).typology).toBe('l_shape')
  })

  test('l_shape typology (S5): explicit wording in all three languages', () => {
    expect(deriveBriefFacts('L形地块，120平米')).toMatchObject({ lShape: true })
    expect(deriveBriefFacts('Ｌ字型の敷地です')).toMatchObject({ lShape: true })
    expect(deriveBriefFacts('an L-shaped lot')).toMatchObject({ lShape: true })
    expect(deriveBriefFacts('三室一厅').lShape).toBeUndefined()
  })

  test('jp profile requires a 玄関 (J5); default does not', () => {
    expect(deriveStrategy({}, { totalAreaSqm: 55 }, JP_NORM_PROFILE).entryRequired).toBe(true)
    expect(deriveStrategy({}, { totalAreaSqm: 55 }, DEFAULT_NORM_PROFILE).entryRequired).toBe(false)
  })
})

describe('applyStrategy', () => {
  const separateKitchenIntent: LayoutIntent = {
    targetTotalAreaSqm: 40,
    rooms: [
      { id: 'living-1', name: '客厅', type: 'living', targetAreaSqm: 16 },
      { id: 'kitchen-1', name: '厨房', type: 'kitchen', targetAreaSqm: 5 },
      { id: 'bedroom-1', name: '主卧', type: 'bedroom', targetAreaSqm: 11 },
      { id: 'bathroom-1', name: '卫生间', type: 'bathroom', targetAreaSqm: 4 },
    ],
    adjacency: [
      { a: 'kitchen-1', b: 'living-1' },
      { a: 'kitchen-1', b: 'bathroom-1' },
    ],
  }

  test('open mode merges separate living+kitchen into living_kitchen', () => {
    const decision = deriveStrategy({ kitchenPreference: 'open' }, { totalAreaSqm: 40 }, DEFAULT_NORM_PROFILE)
    const { intent, notes } = applyStrategy(separateKitchenIntent, decision)
    const merged = intent.rooms.find(room => room.type === 'living_kitchen')
    expect(merged).toBeDefined()
    expect(merged!.id).toBe('living-1')
    expect(merged!.targetAreaSqm).toBe(21)
    expect(intent.rooms.some(room => room.type === 'kitchen')).toBe(false)
    // kitchen↔living became self-adjacency (dropped); kitchen↔bathroom remapped.
    expect(intent.adjacency).toEqual([{ a: 'living-1', b: 'bathroom-1' }])
    expect(notes.join()).toContain('合并')
    // Original intent untouched.
    expect(separateKitchenIntent.rooms).toHaveLength(4)
  })

  test('open mode leaves an intent that already has living_kitchen alone', () => {
    const decision = deriveStrategy({ kitchenPreference: 'open' }, { totalAreaSqm: 40 }, DEFAULT_NORM_PROFILE)
    const intent: LayoutIntent = {
      targetTotalAreaSqm: 40,
      rooms: [
        { id: 'ldk-1', name: 'LDK', type: 'living_kitchen' },
        { id: 'bedroom-1', name: '主卧', type: 'bedroom' },
      ],
    }
    const result = applyStrategy(intent, decision)
    expect(result.intent).toBe(intent)
    expect(result.notes).toEqual([])
  })

  test('user-required closed kitchen vs combined LDK is a note, not a hard split', () => {
    const decision = deriveStrategy({ kitchenPreference: 'closed' }, { totalAreaSqm: 40 }, DEFAULT_NORM_PROFILE)
    const intent: LayoutIntent = {
      targetTotalAreaSqm: 40,
      rooms: [
        { id: 'ldk-1', name: 'LDK', type: 'living_kitchen' },
        { id: 'bedroom-1', name: '主卧', type: 'bedroom' },
      ],
    }
    const result = applyStrategy(intent, decision)
    expect(result.intent.rooms.some(room => room.type === 'living_kitchen')).toBe(true)
    expect(result.notes.join()).toContain('独立厨房')
  })

  test('jp profile adds a 玄関 when the intent has none', () => {
    const decision = deriveStrategy({}, { totalAreaSqm: 55 }, JP_NORM_PROFILE)
    const { intent, notes } = applyStrategy({
      targetTotalAreaSqm: 55,
      rooms: [
        { id: 'ldk-1', name: 'LDK', type: 'living_kitchen' },
        { id: 'bedroom-1', name: '洋室', type: 'bedroom' },
      ],
    }, decision)
    const entry = intent.rooms.find(room => room.type === 'entry')
    expect(entry).toBeDefined()
    expect(entry!.name).toBe('玄関')
    expect(notes.join()).toContain('玄関')
  })
})

describe('buildLayoutPlan with a strategy', () => {
  function scriptedModel(replies: string[]) {
    const seen: ChatMessage[][] = []
    const complete = async (messages: ChatMessage[]) => {
      seen.push(structuredClone(messages))
      const reply = replies.shift()
      if (reply === undefined) throw new Error('scripted model ran out of replies')
      return reply
    }
    return { complete, seen }
  }

  test('injects the strategy into the prompt and enforces the merge on the reply', async () => {
    const intentWithSeparateKitchen: LayoutIntent = {
      targetTotalAreaSqm: 40,
      rooms: [
        { id: 'living-1', name: '客厅', type: 'living', targetAreaSqm: 16 },
        { id: 'kitchen-1', name: '厨房', type: 'kitchen', targetAreaSqm: 5 },
        { id: 'bedroom-1', name: '主卧', type: 'bedroom', targetAreaSqm: 11 },
        { id: 'bathroom-1', name: '卫生间', type: 'bathroom', targetAreaSqm: 4 },
      ],
    }
    const { complete, seen } = scriptedModel([JSON.stringify(intentWithSeparateKitchen)])
    const strategy = deriveStrategy({ kitchenPreference: 'open' }, { totalAreaSqm: 40 }, DEFAULT_NORM_PROFILE)
    const result = await buildLayoutPlan(
      { briefSummary: '40㎡ 一居室，开放式厨房', targets: { totalAreaSqm: 40 } },
      complete,
      { strategy },
    )
    expect(String(seen[0]![1]!.content)).toContain('户型策略')
    expect(strategyPromptLines(strategy)).toContain('living_kitchen')
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('unreachable')
    // The persisted intent and the plan both carry the merge.
    expect(result.intent?.rooms.some(room => room.type === 'living_kitchen')).toBe(true)
    expect(result.intent?.rooms.some(room => room.type === 'kitchen')).toBe(false)
    expect(result.plan.rooms.some(room => room.type === 'living_kitchen')).toBe(true)
    expect(result.plan.notes?.join()).toContain('策略修正')
  })

  test('plan failures carry l10n refs that render in ja/en (遗留③)', async () => {
    // Room areas sum to far more than the total — every partition attempt
    // rejects with the scale-mismatch reason.
    const impossibleIntent: LayoutIntent = {
      targetTotalAreaSqm: 30,
      rooms: [
        { id: 'living-1', name: '客厅', type: 'living', targetAreaSqm: 40 },
        { id: 'bedroom-1', name: '主卧', type: 'bedroom', targetAreaSqm: 30 },
      ],
    }
    const { complete } = scriptedModel([JSON.stringify(impossibleIntent)])
    const result = await buildLayoutPlan(
      { briefSummary: '30㎡ 两室', targets: { totalAreaSqm: 30 } },
      complete,
      { maxRounds: 1 },
    )
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('unreachable')
    expect(result.failuresL10n).toHaveLength(result.failures.length)
    const refs = result.failuresL10n.filter((ref): ref is NonNullable<typeof ref> => ref !== null)
    expect(refs.length).toBeGreaterThan(0)
    const render = issueText as (l: Lang, id: string, params: unknown) => string
    for (const ref of refs) {
      const ja = render('ja', ref.id, ref.params)
      const en = render('en', ref.id, ref.params)
      expect(ja.length).toBeGreaterThan(0)
      expect(en).not.toMatch(/[一-鿿]/)
    }
  })
})

describe('Codex review fixes (strategy)', () => {
  test('open mode folds stray living/kitchen into an existing living_kitchen', () => {
    const decision = deriveStrategy({ kitchenPreference: 'open' }, { totalAreaSqm: 45 }, DEFAULT_NORM_PROFILE)
    const { intent, notes } = applyStrategy({
      targetTotalAreaSqm: 45,
      rooms: [
        { id: 'ldk-1', name: 'LDK', type: 'living_kitchen', targetAreaSqm: 20 },
        { id: 'kitchen-1', name: '厨房', type: 'kitchen', targetAreaSqm: 5 },
        { id: 'bedroom-1', name: '主卧', type: 'bedroom', targetAreaSqm: 12 },
      ],
      adjacency: [{ a: 'kitchen-1', b: 'bedroom-1' }],
    }, decision)
    expect(intent.rooms.some(room => room.type === 'kitchen')).toBe(false)
    const merged = intent.rooms.find(room => room.id === 'ldk-1')!
    expect(merged.targetAreaSqm).toBe(25)
    expect(intent.adjacency).toEqual([{ a: 'ldk-1', b: 'bedroom-1' }])
    expect(notes.join()).toContain('并入')
  })

  test('folding never understates an LDK that has no explicit area', () => {
    const decision = deriveStrategy({ kitchenPreference: 'open' }, { totalAreaSqm: 45 }, DEFAULT_NORM_PROFILE)
    const { intent } = applyStrategy({
      targetTotalAreaSqm: 45,
      rooms: [
        { id: 'ldk-1', name: 'LDK', type: 'living_kitchen' },
        { id: 'kitchen-1', name: '厨房', type: 'kitchen', targetAreaSqm: 6 },
        { id: 'bedroom-1', name: '主卧', type: 'bedroom' },
      ],
    }, decision)
    const merged = intent.rooms.find(room => room.id === 'ldk-1')!
    expect(merged.targetAreaSqm).toBeUndefined()
    expect(intent.rooms.some(room => room.type === 'kitchen')).toBe(false)
  })
})

describe('applyStrategy area clamp (§4 tier-1, case-04 补齐)', () => {
  test('a 23㎡ kitchen clamps to the band softMax with a note, silently', () => {
    const decision = deriveStrategy({}, { totalAreaSqm: 110 }, DEFAULT_NORM_PROFILE)
    const intent: LayoutIntent = {
      targetTotalAreaSqm: 110,
      rooms: [
        { id: 'living-1', name: '客厅', type: 'living', targetAreaSqm: 28 },
        { id: 'bedroom-1', name: '主卧', type: 'bedroom', targetAreaSqm: 16 },
        { id: 'bedroom-2', name: '次卧', type: 'bedroom', targetAreaSqm: 12 },
        { id: 'kitchen-1', name: '厨房', type: 'kitchen', targetAreaSqm: 23 },
        { id: 'bath-1', name: '卫生间', type: 'bathroom', targetAreaSqm: 5 },
      ],
    }
    const { intent: applied, notes } = applyStrategy(intent, decision, DEFAULT_NORM_PROFILE)
    const kitchen = applied.rooms.find(room => room.id === 'kitchen-1')!
    expect(kitchen.targetAreaSqm).toBeLessThan(23)
    expect(notes.join()).toContain('策略修正')
    expect(notes.join()).toContain('厨房')
    // In-band rooms untouched.
    expect(applied.rooms.find(room => room.id === 'bedroom-1')?.targetAreaSqm).toBe(16)
  })

  test('without a profile the clamp is skipped (legacy call shape)', () => {
    const decision = deriveStrategy({}, { totalAreaSqm: 110 }, DEFAULT_NORM_PROFILE)
    const intent: LayoutIntent = {
      targetTotalAreaSqm: 110,
      rooms: [{ id: 'kitchen-1', name: '厨房', type: 'kitchen', targetAreaSqm: 23 }],
    }
    expect(applyStrategy(intent, decision).intent.rooms[0]!.targetAreaSqm).toBe(23)
  })
})

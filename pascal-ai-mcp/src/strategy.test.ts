import { describe, expect, test } from 'bun:test'
import { issueText, type Lang } from './lang/i18n'
import { detectRoomProgram, parseRoomProgram } from './lang/strategy-vocab'
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
    expect(deriveBriefFacts('2LDKでお願いします')).toEqual({ roomProgram: '2ldk' })
    expect(deriveBriefFacts('リビングダイニングキッチンにしてください')).toEqual({ kitchenPreference: 'open' })
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

describe('detectRoomProgram（日本房型编号，确定性解析）', () => {
  test('半角/全角/大小写/空格变体', () => {
    expect(detectRoomProgram('给我生成一个 2DK，45 平米的户型')).toBe('2dk')
    expect(detectRoomProgram('２ＬＤＫをお願いします')).toBe('2ldk')
    expect(detectRoomProgram('２ＤＫ')).toBe('2dk')
    expect(detectRoomProgram('3 ldk で')).toBe('3ldk')
    expect(detectRoomProgram('1LDK 31㎡')).toBe('1ldk')
    expect(detectRoomProgram('1K 25㎡')).toBe('1k')
    expect(detectRoomProgram('1R 37㎡')).toBe('1r')
    expect(detectRoomProgram('ワンルームで')).toBe('1r')
  })

  test('不误报：无编号/嵌在单词里/2K 不在 v1 类型内', () => {
    expect(detectRoomProgram('三室两厅')).toBeUndefined()
    expect(detectRoomProgram('budget 10k')).toBeUndefined()
    expect(detectRoomProgram('x2LDKy')).toBeUndefined()
    expect(detectRoomProgram('2K アパート')).toBeUndefined()
    expect(detectRoomProgram('宽5米长18米')).toBeUndefined()
  })

  test('SLDK 变体结构化解析：保留 base program + serviceRoomCount，不整体丢弃（Codex 复审 #1）', () => {
    expect(parseRoomProgram('2SLDK マンション')).toEqual({ program: '2ldk', serviceRoomCount: 1 })
    expect(parseRoomProgram('２ＳＬＤＫ')).toEqual({ program: '2ldk', serviceRoomCount: 1 })
    expect(parseRoomProgram('1SLDK 45㎡')).toEqual({ program: '1ldk', serviceRoomCount: 1 })
    expect(parseRoomProgram('1SDK 35㎡')).toEqual({ program: '1dk', serviceRoomCount: 1 })
    // detectRoomProgram 视角：base program 不丢，也绝不折叠掉 S 的存在——
    // S 在 BriefFacts.serviceRoomCount 上单独承载。
    expect(detectRoomProgram('2SLDK マンション')).toBe('2ldk')
    expect(deriveBriefFacts('2SLDK 60㎡')).toEqual({ roomProgram: '2ldk', serviceRoomCount: 1 })
    expect(deriveBriefFacts('２ＳＬＤＫ 60㎡')).toEqual({ roomProgram: '2ldk', serviceRoomCount: 1 })
    // 无 S 的编号不带 serviceRoomCount。
    expect(deriveBriefFacts('2LDK 60㎡')).toEqual({ roomProgram: '2ldk' })
  })
})

describe('SLDK 全链路（Codex 复审 #1：服务间不静默丢失）', () => {
  const 二SLDK策略 = () =>
    deriveStrategy(deriveBriefFacts('2SLDK 60㎡'), { totalAreaSqm: 60 }, JP_NORM_PROFILE)

  test('2SLDK 仍按 LDK 公共区处理，不因 standard 面积段默认变成独立厨房', () => {
    const decision = 二SLDK策略()
    expect(decision.roomProgram).toBe('2ldk')
    expect(decision.serviceRoomCount).toBe(1)
    expect(decision.kitchenMode).toBe('open')
    expect(decision.kitchenModeSource).toBe('program')
    const prompt = strategyPromptLines(decision)
    expect(prompt).toContain('living_kitchen')
    expect(prompt).toContain('納戸')
    expect(prompt).toContain('type storage')
  })

  test('模型遗漏服务间时 applyStrategy 确定性补納戸；正确输出时保留不重复', () => {
    const decision = 二SLDK策略()
    const 遗漏: LayoutIntent = {
      targetTotalAreaSqm: 60,
      rooms: [
        { id: 'bedroom-1', name: '洋室1', type: 'bedroom' },
        { id: 'bedroom-2', name: '洋室2', type: 'bedroom' },
        { id: 'lk-1', name: 'LDK', type: 'living_kitchen' },
        { id: 'bath-1', name: '浴室', type: 'bathroom' },
      ],
    }
    const repaired = applyStrategy(遗漏, decision, JP_NORM_PROFILE)
    const storages = repaired.intent.rooms.filter(room => room.type === 'storage')
    expect(storages).toHaveLength(1)
    expect(storages[0]!.name).toBe('納戸')
    expect(repaired.notes.some(note => note.includes('補充') || note.includes('补充'))).toBe(true)

    const 已含: LayoutIntent = {
      ...遗漏,
      rooms: [...遗漏.rooms, { id: 'service-1', name: '納戸', type: 'storage' }],
    }
    const kept = applyStrategy(已含, decision, JP_NORM_PROFILE)
    expect(kept.intent.rooms.filter(room => room.type === 'storage')).toHaveLength(1)

    const 仅有衣柜: LayoutIntent = {
      ...遗漏,
      rooms: [...遗漏.rooms, { id: 'closet-1', name: 'クローゼット', type: 'storage' }],
    }
    const withCloset = applyStrategy(仅有衣柜, decision, JP_NORM_PROFILE)
    expect(withCloset.intent.rooms.filter(room => room.type === 'storage')).toHaveLength(2)
    expect(withCloset.intent.rooms.some(room => room.name === '納戸')).toBe(true)
  })
})

describe('房型编号归一化（applyStrategy program normalization）', () => {
  test('2DK：模型拆出 dining+kitchen 归一为一间 DK（living_kitchen）', () => {
    const facts = deriveBriefFacts('2DK，45平米')
    expect(facts.roomProgram).toBe('2dk')
    const decision = deriveStrategy(facts, { totalAreaSqm: 45 }, JP_NORM_PROFILE)
    expect(decision.kitchenMode).toBe('open')
    const intent: LayoutIntent = {
      targetTotalAreaSqm: 45,
      rooms: [
        { id: 'bedroom-1', name: '洋室1', type: 'bedroom' },
        { id: 'bedroom-2', name: '洋室2', type: 'bedroom' },
        { id: 'dining-1', name: '餐厅', type: 'dining', targetAreaSqm: 6 },
        { id: 'kitchen-1', name: '厨房', type: 'kitchen', targetAreaSqm: 5 },
        { id: 'entry-1', name: '玄関', type: 'entry' },
      ],
      adjacency: [
        { a: 'dining-1', b: 'kitchen-1' },
        { a: 'kitchen-1', b: 'entry-1' },
        { a: 'dining-1', b: 'entry-1' },
      ],
    }
    const { intent: applied, notes } = applyStrategy(intent, decision, JP_NORM_PROFILE)
    const hubs = applied.rooms.filter(room => room.type === 'living_kitchen')
    expect(hubs).toHaveLength(1)
    expect(hubs[0]!.name).toBe('DK')
    expect(hubs[0]!.id).toBe('dining-1')
    expect(hubs[0]!.targetAreaSqm).toBe(11)
    expect(applied.rooms.some(room => room.type === 'dining' || room.type === 'kitchen')).toBe(false)
    // adjacency：自环删除、重复去重、无悬挂 id。
    const ids = new Set(applied.rooms.map(room => room.id))
    expect(applied.adjacency).toEqual([{ a: 'dining-1', b: 'entry-1' }])
    for (const pair of applied.adjacency ?? []) {
      expect(ids.has(pair.a)).toBe(true)
      expect(ids.has(pair.b)).toBe(true)
    }
    expect(notes.join()).toContain('2DK')
  })

  test('2LDK：living+dining+kitchen 三间归一为一间 LDK，不残留 dining', () => {
    const decision = deriveStrategy(deriveBriefFacts('2LDK 60㎡'), { totalAreaSqm: 60 }, JP_NORM_PROFILE)
    const intent: LayoutIntent = {
      targetTotalAreaSqm: 60,
      rooms: [
        { id: 'bedroom-1', name: '主卧', type: 'bedroom' },
        { id: 'bedroom-2', name: '次卧', type: 'bedroom' },
        { id: 'living-1', name: '客厅', type: 'living', targetAreaSqm: 14 },
        { id: 'dining-1', name: '餐厅', type: 'dining', targetAreaSqm: 6 },
        { id: 'kitchen-1', name: '厨房', type: 'kitchen', targetAreaSqm: 5 },
      ],
    }
    const { intent: applied } = applyStrategy(intent, decision, JP_NORM_PROFILE)
    const hubs = applied.rooms.filter(room => room.type === 'living_kitchen')
    expect(hubs).toHaveLength(1)
    // 客厅名不属于 DK 命名，hubForm 已是 ldk —— 保留模型起的名字。
    expect(hubs[0]!.id).toBe('living-1')
    expect(hubs[0]!.targetAreaSqm).toBe(25)
    expect(applied.rooms.some(room => room.type === 'dining' || room.type === 'kitchen' || room.type === 'living')).toBe(false)
  })

  test('DK 命名守卫：2DK 下模型输出的 living_kitchen 若名字不判为 DK 则改名', () => {
    const decision = deriveStrategy(deriveBriefFacts('2DK 44㎡'), { totalAreaSqm: 44 }, JP_NORM_PROFILE)
    const intent: LayoutIntent = {
      targetTotalAreaSqm: 44,
      rooms: [
        { id: 'bedroom-1', name: '洋室1', type: 'bedroom' },
        { id: 'bedroom-2', name: '洋室2', type: 'bedroom' },
        { id: 'lk-1', name: '客餐厨', type: 'living_kitchen' },
      ],
    }
    const { intent: applied } = applyStrategy(intent, decision, JP_NORM_PROFILE)
    expect(applied.rooms.find(room => room.id === 'lk-1')!.name).toBe('DK')
  })

  test('1LDK 下模型把 hub 命名为 DK 时纠正为 LDK（hubForm 不串档）', () => {
    const decision = deriveStrategy(deriveBriefFacts('1LDK 31㎡'), { totalAreaSqm: 31 }, JP_NORM_PROFILE)
    const intent: LayoutIntent = {
      targetTotalAreaSqm: 31,
      rooms: [
        { id: 'bedroom-1', name: '洋室', type: 'bedroom' },
        { id: 'lk-1', name: 'DK', type: 'living_kitchen' },
      ],
    }
    const { intent: applied } = applyStrategy(intent, decision, JP_NORM_PROFILE)
    expect(applied.rooms.find(room => room.id === 'lk-1')!.name).toBe('LDK')
  })

  test('2LDK+明确独立厨房：dining 并入 living，kitchen 保持独立（separate hubForm）', () => {
    const facts = deriveBriefFacts('2LDK 58㎡，要独立厨房')
    expect(facts.kitchenPreference).toBe('closed')
    const decision = deriveStrategy(facts, { totalAreaSqm: 58 }, JP_NORM_PROFILE)
    expect(decision.kitchenMode).toBe('closed')
    const intent: LayoutIntent = {
      targetTotalAreaSqm: 58,
      rooms: [
        { id: 'bedroom-1', name: '主卧', type: 'bedroom' },
        { id: 'bedroom-2', name: '次卧', type: 'bedroom' },
        { id: 'living-1', name: 'リビング', type: 'living', targetAreaSqm: 12 },
        { id: 'dining-1', name: 'ダイニング', type: 'dining', targetAreaSqm: 6 },
        { id: 'kitchen-1', name: 'キッチン', type: 'kitchen', targetAreaSqm: 5 },
      ],
    }
    const { intent: applied } = applyStrategy(intent, decision, JP_NORM_PROFILE)
    expect(applied.rooms.some(room => room.type === 'dining')).toBe(false)
    expect(applied.rooms.some(room => room.type === 'kitchen')).toBe(true)
    expect(applied.rooms.some(room => room.type === 'living_kitchen')).toBe(false)
    expect(applied.rooms.find(room => room.id === 'living-1')!.targetAreaSqm).toBe(18)
  })

  test('部分房间无显式面积时合并结果不求和（避免低估 hub）', () => {
    const decision = deriveStrategy(deriveBriefFacts('2DK 44㎡'), { totalAreaSqm: 44 }, JP_NORM_PROFILE)
    const intent: LayoutIntent = {
      targetTotalAreaSqm: 44,
      rooms: [
        { id: 'bedroom-1', name: '洋室1', type: 'bedroom' },
        { id: 'bedroom-2', name: '洋室2', type: 'bedroom' },
        { id: 'dining-1', name: '餐厅', type: 'dining', targetAreaSqm: 6 },
        { id: 'kitchen-1', name: '厨房', type: 'kitchen' },
      ],
    }
    const { intent: applied } = applyStrategy(intent, decision, JP_NORM_PROFILE)
    expect(applied.rooms.find(room => room.type === 'living_kitchen')!.targetAreaSqm).toBeUndefined()
  })

  test('无日本房型编号时行为不变（默认 profile 零影响）', () => {
    const facts = deriveBriefFacts('三室两厅，110平米')
    expect(facts.roomProgram).toBeUndefined()
    const decision = deriveStrategy(facts, { totalAreaSqm: 110 }, DEFAULT_NORM_PROFILE)
    expect(decision.roomProgram).toBeUndefined()
    expect(decision.kitchenMode).toBe('closed')
  })
})

describe('1K/1R 房型（Codex review #1：Prompt 与归一化都必须保独立厨房）', () => {
  test('1K/1R 强制 kitchenMode=closed（compact 面积段默认 open 被编号覆盖）', () => {
    const oneK = deriveStrategy(deriveBriefFacts('1K 25㎡'), { totalAreaSqm: 25 }, JP_NORM_PROFILE)
    expect(oneK.kitchenMode).toBe('closed')
    expect(oneK.kitchenModeSource).toBe('program')
    expect(oneK.kitchenInScope).toBe(true)
    const oneR = deriveStrategy(deriveBriefFacts('1R 37㎡'), { totalAreaSqm: 37 }, JP_NORM_PROFILE)
    expect(oneR.kitchenMode).toBe('closed')
    // 房型编号优先；显式开放式偏好保留冲突说明，但不让 prompt 与归一化分叉。
    const explicitOpen = deriveStrategy(deriveBriefFacts('1R 37㎡ 开放式厨房'), { totalAreaSqm: 37 }, JP_NORM_PROFILE)
    expect(explicitOpen.kitchenMode).toBe('closed')
    expect(explicitOpen.kitchenModeSource).toBe('program')
    expect(explicitOpen.notes.join()).toContain('策略冲突')
    expect(strategyPromptLines(explicitOpen)).toContain('type kitchen')
    expect(strategyPromptLines(explicitOpen)).not.toContain('输出一间 type 为 living_kitchen')
  })

  test('Prompt 指令要求 bedroom+kitchen，不出现 living_kitchen 指令', () => {
    const lines = strategyPromptLines(
      deriveStrategy(deriveBriefFacts('1K 25㎡'), { totalAreaSqm: 25 }, JP_NORM_PROFILE),
    )
    expect(lines).toContain('房型 1K')
    expect(lines).toContain('type kitchen')
    expect(lines).not.toContain('输出一间 type 为 living_kitchen')
  })

  test('归一化：模型输出 bedroom+living_kitchen 时 living_kitchen 规范为独立厨房', () => {
    const decision = deriveStrategy(deriveBriefFacts('1K 25㎡'), { totalAreaSqm: 25 }, JP_NORM_PROFILE)
    const { intent: applied, notes } = applyStrategy({
      targetTotalAreaSqm: 25,
      rooms: [
        { id: 'bedroom-1', name: '洋室', type: 'bedroom' },
        { id: 'lk-1', name: 'LDK', type: 'living_kitchen', targetAreaSqm: 12 },
      ],
      adjacency: [{ a: 'bedroom-1', b: 'lk-1' }],
    }, decision, JP_NORM_PROFILE)
    const kitchen = applied.rooms.find(room => room.type === 'kitchen')
    expect(kitchen).toBeDefined()
    expect(kitchen!.id).toBe('lk-1')
    expect(applied.rooms.some(room => room.type === 'living_kitchen')).toBe(false)
    expect(applied.adjacency).toEqual([{ a: 'bedroom-1', b: 'lk-1' }])
    expect(notes.join()).toContain('独立厨房')
  })

  test('归一化：多余的 living/dining 并入主居室；已有 kitchen 时 living_kitchen 也并入', () => {
    const decision = deriveStrategy(deriveBriefFacts('1R 37㎡'), { totalAreaSqm: 37 }, JP_NORM_PROFILE)
    const { intent: applied } = applyStrategy({
      targetTotalAreaSqm: 37,
      rooms: [
        { id: 'bedroom-1', name: 'スタジオ', type: 'bedroom' },
        { id: 'living-1', name: 'リビング', type: 'living' },
        { id: 'kitchen-1', name: 'キッチン', type: 'kitchen' },
      ],
    }, decision, JP_NORM_PROFILE)
    // jp 档还会自动补玄関（J5）。
    expect(applied.rooms.map(room => room.type).sort()).toEqual(['bedroom', 'entry', 'kitchen'])
    expect(applied.rooms.find(room => room.type === 'bedroom')!.id).toBe('bedroom-1')
  })

  test('没有 bedroom 的畸形输出不强行归一（落分区器/修正轮）', () => {
    const decision = deriveStrategy(deriveBriefFacts('1K 25㎡'), { totalAreaSqm: 25 }, JP_NORM_PROFILE)
    const intent: LayoutIntent = {
      targetTotalAreaSqm: 25,
      rooms: [{ id: 'lk-1', name: 'LDK', type: 'living_kitchen' }],
    }
    const { intent: applied } = applyStrategy(intent, decision, JP_NORM_PROFILE)
    expect(applied.rooms.find(room => room.id === 'lk-1')!.type).toBe('living_kitchen')
  })
})

describe('独立厨房 NLDK 的 living_kitchen 冲突形态（Codex review #4）', () => {
  test('living_kitchen(LDK)+kitchen → living(LD)+kitchen，adjacency 保持', () => {
    const decision = deriveStrategy(deriveBriefFacts('2LDK 58㎡ 独立厨房'), { totalAreaSqm: 58 }, JP_NORM_PROFILE)
    expect(decision.kitchenMode).toBe('closed')
    const { intent: applied, notes } = applyStrategy({
      targetTotalAreaSqm: 58,
      rooms: [
        { id: 'bedroom-1', name: '主寝室', type: 'bedroom' },
        { id: 'bedroom-2', name: '洋室', type: 'bedroom' },
        { id: 'lk-1', name: 'LDK', type: 'living_kitchen', targetAreaSqm: 16 },
        { id: 'kitchen-1', name: 'キッチン', type: 'kitchen', targetAreaSqm: 5 },
      ],
      adjacency: [{ a: 'lk-1', b: 'kitchen-1' }],
    }, decision, JP_NORM_PROFILE)
    const living = applied.rooms.find(room => room.type === 'living')
    expect(living).toBeDefined()
    expect(living!.id).toBe('lk-1')
    // hub 名 LDK 会被词表误判——改为标准 LD 简称。
    expect(living!.name).toBe('LD')
    expect(applied.rooms.some(room => room.type === 'living_kitchen')).toBe(false)
    expect(applied.rooms.some(room => room.type === 'kitchen')).toBe(true)
    expect(applied.adjacency).toEqual([{ a: 'lk-1', b: 'kitchen-1' }])
    expect(notes.join()).toContain('归一为一间客餐厅')
  })

  test('living_kitchen 但没有独立 kitchen 时不硬拆，保留提示语义', () => {
    const decision = deriveStrategy(deriveBriefFacts('2LDK 58㎡ 独立厨房'), { totalAreaSqm: 58 }, JP_NORM_PROFILE)
    const { intent: applied } = applyStrategy({
      targetTotalAreaSqm: 58,
      rooms: [
        { id: 'bedroom-1', name: '主寝室', type: 'bedroom' },
        { id: 'bedroom-2', name: '洋室', type: 'bedroom' },
        { id: 'lk-1', name: 'LDK', type: 'living_kitchen' },
      ],
    }, decision, JP_NORM_PROFILE)
    expect(applied.rooms.find(room => room.id === 'lk-1')!.type).toBe('living_kitchen')
  })
})

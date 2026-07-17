import { describe, expect, test } from 'bun:test'
import { findMissingFurniture } from './furniture-checklist'
import type { LayoutIntent } from './layout-plan'
import { polygonArea } from './layout-plan'
import { DEFAULT_NORM_PROFILE, JP_NORM_PROFILE } from './norms/profile'
import { findTemplateSeed } from './template-seed'

const 二LDK: LayoutIntent = {
  targetTotalAreaSqm: 60,
  rooms: [
    { id: 'bedroom-1', name: '主卧', type: 'bedroom', targetAreaSqm: 10 },
    { id: 'bedroom-2', name: '次卧', type: 'bedroom', targetAreaSqm: 9 },
    { id: 'lk-1', name: 'LDK', type: 'living_kitchen', targetAreaSqm: 20 },
    { id: 'bath-1', name: '卫生间', type: 'bathroom' },
  ],
}

describe('findTemplateSeed', () => {
  test('2LDK 60㎡ 命中田の字参照并映射核心房间', () => {
    const seed = findTemplateSeed(二LDK, JP_NORM_PROFILE)
    expect(seed).not.toBeNull()
    expect(seed!.templateId).toBe('tpl-jp-2ldk-60-tanoji')
    expect(seed!.validation.fatal).toEqual([])
    const roomIds = new Set(seed!.plan.rooms.map(room => room.id))
    // Core rooms take the intent's identity; service rooms keep the template's.
    expect(roomIds.has('bedroom-1')).toBe(true)
    expect(roomIds.has('lk-1')).toBe(true)
    expect(seed!.plan.rooms.some(room => room.name === '主卧')).toBe(true)
    expect(seed!.plan.rooms.some(room => room.name === 'トイレ')).toBe(true)
    // 主卧 (larger intent target) maps onto the larger 洋室.
    const bedrooms = seed!.plan.rooms.filter(room => room.type === 'bedroom')
    const main = bedrooms.find(room => room.id === 'bedroom-1')!
    const second = bedrooms.find(room => room.id === 'bedroom-2')!
    expect(polygonArea(main.polygon)).toBeGreaterThanOrEqual(polygonArea(second.polygon))
    // Connections and entry only reference existing rooms.
    for (const connection of seed!.plan.connections) {
      expect(roomIds.has(connection.from)).toBe(true)
      expect(roomIds.has(connection.to)).toBe(true)
    }
    expect(roomIds.has(seed!.plan.entry.roomId)).toBe(true)
    // Uniform scaling keeps the lot area at the target.
    const lot = seed!.plan.footprint.width * seed!.plan.footprint.depth
    expect(Math.abs(lot - 60) / 60).toBeLessThan(0.03)
    expect(seed!.notes.some(note => note.includes('复用参照户型'))).toBe(true)
  })

  test('DK 命名的两居命中 2DK 参照而不是 2LDK', () => {
    const intent: LayoutIntent = {
      targetTotalAreaSqm: 43,
      rooms: [
        { id: 'bedroom-1', name: '洋室1', type: 'bedroom' },
        { id: 'bedroom-2', name: '洋室2', type: 'bedroom' },
        { id: 'dk-1', name: 'DK', type: 'living_kitchen' },
        { id: 'bath-1', name: '浴室', type: 'bathroom' },
      ],
    }
    const seed = findTemplateSeed(intent, JP_NORM_PROFILE)
    expect(seed).not.toBeNull()
    expect(seed!.templateId).toMatch(/^tpl-jp-2dk/)
  })

  test('3LDK 70㎡ 命中 tpl-jp-3ldk-70（2026-07-16 收录，此前该档为空）', () => {
    const intent: LayoutIntent = {
      targetTotalAreaSqm: 70,
      rooms: [
        { id: 'bedroom-1', name: '主卧', type: 'bedroom' },
        { id: 'bedroom-2', name: '次卧', type: 'bedroom' },
        { id: 'bedroom-3', name: '客卧', type: 'bedroom' },
        { id: 'lk-1', name: 'LDK', type: 'living_kitchen' },
        { id: 'bath-1', name: '卫生间', type: 'bathroom' },
      ],
    }
    const seed = findTemplateSeed(intent, JP_NORM_PROFILE)
    expect(seed).not.toBeNull()
    expect(seed!.templateId).toBe('tpl-jp-3ldk-70')
    expect(seed!.validation.fatal).toEqual([])
  })

  test('库里没有的房型（4 卧）不命中，回落分区器', () => {
    const intent: LayoutIntent = {
      targetTotalAreaSqm: 70,
      rooms: [
        { id: 'bedroom-1', name: '主卧', type: 'bedroom' },
        { id: 'bedroom-2', name: '次卧', type: 'bedroom' },
        { id: 'bedroom-3', name: '客卧', type: 'bedroom' },
        { id: 'bedroom-4', name: '儿童房', type: 'bedroom' },
        { id: 'lk-1', name: 'LDK', type: 'living_kitchen' },
        { id: 'bath-1', name: '卫生间', type: 'bathroom' },
      ],
    }
    expect(findTemplateSeed(intent, JP_NORM_PROFILE)).toBeNull()
  })

  test('面积超出缩放范围不命中', () => {
    expect(findTemplateSeed({ ...二LDK, targetTotalAreaSqm: 90 }, JP_NORM_PROFILE)).toBeNull()
  })

  test('Intent 多要一间书房时模板缺书房不命中', () => {
    const intent: LayoutIntent = {
      ...二LDK,
      rooms: [...二LDK.rooms, { id: 'study-1', name: '书房', type: 'study' as const }],
    }
    expect(findTemplateSeed(intent, JP_NORM_PROFILE)).toBeNull()
  })

  test('default profile 不吃 jp 模板', () => {
    expect(findTemplateSeed(二LDK, DEFAULT_NORM_PROFILE)).toBeNull()
  })

  test('带地块尺寸约束时不做种子', () => {
    const seed = findTemplateSeed(二LDK, JP_NORM_PROFILE, {
      typology: 'standard_band',
      footprintHint: { widthM: 6, depthM: 10 },
    })
    expect(seed).toBeNull()
  })

  test('requiredRooms 的服务房数量是匹配下限——模板可以更丰富，不能更少', () => {
    // 荒谬的 99 卫必须落空，而不是静默命中 3 卫模板。
    expect(findTemplateSeed(二LDK, JP_NORM_PROFILE, undefined, {
      targets: { requiredRooms: [{ type: 'bathroom', count: 99 }] },
    })).toBeNull()
    // 2 卫要求可以由模板的卫浴分离（≥2 个 bathroom 房间）满足。
    const seed = findTemplateSeed(二LDK, JP_NORM_PROFILE, undefined, {
      targets: { requiredRooms: [{ type: 'bathroom', count: 2 }] },
    })
    expect(seed).not.toBeNull()
    expect(seed!.plan.rooms.filter(room => room.type === 'bathroom').length).toBeGreaterThanOrEqual(2)
  })

  test('模板不能私带 Intent 没要的核心房间（书房/餐厅等必须双向数量一致）', () => {
    // 二LDK 已含 living_kitchen；再要求一间 study——库里没有带书房的
    // 2LDK 模板，禁止「模板多带」意味着也不允许反向放宽命中。
    const withStudy: LayoutIntent = {
      ...二LDK,
      rooms: [...二LDK.rooms, { id: 'study-1', name: '书房', type: 'study' }],
    }
    expect(findTemplateSeed(withStudy, JP_NORM_PROFILE)).toBeNull()
  })
})

describe('J6-lite 卫浴分离清单', () => {
  test('トイレ/洗面室/浴室 按名字只要各自的设备（jp 市场档）', () => {
    expect(findMissingFurniture('bathroom', [], 'トイレ', 'jp').map(r => r.key)).toEqual(['toilet'])
    expect(findMissingFurniture('bathroom', [], '洗面室', 'jp').map(r => r.key)).toEqual(['washbasin'])
    expect(findMissingFurniture('bathroom', [], '浴室', 'jp').map(r => r.key)).toEqual(['shower_or_bathtub'])
    // 假名词条不需要市场档也能识别——トイレ在任何场景都只可能是厕所。
    expect(findMissingFurniture('bathroom', [], 'トイレ').map(r => r.key)).toEqual(['toilet'])
  })

  test('泛称卫生间保持全套要求', () => {
    expect(findMissingFurniture('bathroom', [], '卫生间')).toHaveLength(3)
    expect(findMissingFurniture('bathroom', [])).toHaveLength(3)
  })

  test('中文泛称「浴室/厕所」在非 jp 档下不缩集——zh 老场景的完整卫生间不能被豁免马桶洗手台', () => {
    expect(findMissingFurniture('bathroom', [], '浴室')).toHaveLength(3)
    expect(findMissingFurniture('bathroom', [], '厕所')).toHaveLength(3)
    expect(findMissingFurniture('bathroom', [], '厕所', 'jp').map(r => r.key)).toEqual(['toilet'])
  })
})

// ---------------------------------------------------------------------------
// 房型编号全链路：brief 文本 → deriveStrategy → applyStrategy 归一化 →
// findTemplateSeed。覆盖此前「模型随机拆房导致模板不命中」的整组问题。
// ---------------------------------------------------------------------------

import { applyStrategy, deriveBriefFacts, deriveStrategy } from './strategy'

function seedFromBrief(briefText: string, rawIntent: LayoutIntent, trace?: string[]) {
  const strategy = deriveStrategy(
    deriveBriefFacts(briefText),
    { totalAreaSqm: rawIntent.targetTotalAreaSqm },
    JP_NORM_PROFILE,
  )
  const { intent } = applyStrategy(rawIntent, strategy, JP_NORM_PROFILE)
  return {
    intent,
    strategy,
    seed: findTemplateSeed(intent, JP_NORM_PROFILE, strategy, trace ? { trace } : undefined),
  }
}

describe('房型编号 → 模板命中（自然语言链路）', () => {
  const 二DK拆分: LayoutIntent = {
    targetTotalAreaSqm: 45,
    rooms: [
      { id: 'bedroom-1', name: '洋室1', type: 'bedroom' },
      { id: 'bedroom-2', name: '洋室2', type: 'bedroom' },
      { id: 'dining-1', name: '餐厅', type: 'dining' },
      { id: 'kitchen-1', name: '厨房', type: 'kitchen' },
      { id: 'bath-1', name: '卫生间', type: 'bathroom' },
    ],
    adjacency: [{ a: 'dining-1', b: 'kitchen-1' }],
  }

  test('2DK 45㎡：模型拆出 dining+kitchen 仍命中 tpl-jp-2dk-44', () => {
    const { seed, intent } = seedFromBrief('给我生成一个 2DK，45 平米的户型', 二DK拆分)
    expect(intent.rooms.filter(room => room.type === 'living_kitchen')).toHaveLength(1)
    expect(seed).not.toBeNull()
    expect(seed!.templateId).toBe('tpl-jp-2dk-44')
    // 归一化 + 核心房间映射后 connections 不引用已删除 id。
    const ids = new Set(seed!.plan.rooms.map(room => room.id))
    for (const connection of seed!.plan.connections) {
      expect(ids.has(connection.from)).toBe(true)
      expect(ids.has(connection.to)).toBe(true)
    }
  })

  test('全角 ２ＤＫ 同样命中', () => {
    const { seed } = seedFromBrief('２ＤＫ、４５平米でお願いします', 二DK拆分)
    expect(seed).not.toBeNull()
    expect(seed!.templateId).toBe('tpl-jp-2dk-44')
  })

  test('3DK 49㎡ 拆分输出命中 tpl-jp-3dk-49', () => {
    const { seed } = seedFromBrief('3DK 49㎡', {
      targetTotalAreaSqm: 49,
      rooms: [
        { id: 'bedroom-1', name: '洋室1', type: 'bedroom' },
        { id: 'bedroom-2', name: '洋室2', type: 'bedroom' },
        { id: 'bedroom-3', name: '洋室3', type: 'bedroom' },
        { id: 'dining-1', name: 'ダイニング', type: 'dining' },
        { id: 'kitchen-1', name: 'キッチン', type: 'kitchen' },
      ],
    })
    expect(seed).not.toBeNull()
    expect(seed!.templateId).toBe('tpl-jp-3dk-49')
  })

  test('2LDK 60㎡：living+dining+kitchen 三拆归一为 LDK 后命中 2LDK 模板（且不是独立厨房变体）', () => {
    const { seed, intent } = seedFromBrief('2LDK 60㎡', {
      targetTotalAreaSqm: 60,
      rooms: [
        { id: 'bedroom-1', name: '主卧', type: 'bedroom' },
        { id: 'bedroom-2', name: '次卧', type: 'bedroom' },
        { id: 'living-1', name: 'リビング', type: 'living' },
        { id: 'dining-1', name: 'ダイニング', type: 'dining' },
        { id: 'kitchen-1', name: 'キッチン', type: 'kitchen' },
      ],
    })
    expect(intent.rooms.filter(room => room.type === 'living_kitchen')).toHaveLength(1)
    expect(intent.rooms.some(room => room.type === 'dining')).toBe(false)
    expect(seed).not.toBeNull()
    expect(seed!.templateId).toMatch(/^tpl-jp-2ldk/)
    expect(seed!.templateId).not.toBe('tpl-jp-2ldk-58')
  })

  test('1DK 与 1LDK 不串档：1LDK 31㎡ 命中 tpl-jp-1ldk-31，1DK 31㎡ 落空', () => {
    const 单卧 = (name: string): LayoutIntent => ({
      targetTotalAreaSqm: 31,
      rooms: [
        { id: 'bedroom-1', name: '洋室', type: 'bedroom' },
        { id: 'lk-1', name, type: 'living_kitchen' },
      ],
    })
    const ldk = seedFromBrief('1LDK 31㎡', 单卧('LDK'))
    expect(ldk.seed).not.toBeNull()
    expect(ldk.seed!.templateId).toBe('tpl-jp-1ldk-31')
    // 模型即使把 hub 命名成 DK，1LDK 编号也会先归一再匹配。
    const ldkNamedDk = seedFromBrief('1LDK 31㎡', 单卧('DK'))
    expect(ldkNamedDk.seed?.templateId).toBe('tpl-jp-1ldk-31')
    // 1DK 请求不允许命中 1LDK 模板（库里当前没有 1DK 参照 → 落分区器）。
    const dk = seedFromBrief('1DK 31㎡', 单卧('DK'))
    expect(dk.seed).toBeNull()
  })

  test('1R 与 1K 不互相命中', () => {
    const 单室 = (area: number): LayoutIntent => ({
      targetTotalAreaSqm: area,
      rooms: [
        { id: 'bedroom-1', name: '洋室', type: 'bedroom' },
        { id: 'kitchen-1', name: 'キッチン', type: 'kitchen' },
      ],
    })
    const r37 = seedFromBrief('1R 37㎡ のマンション', 单室(37))
    expect(r37.seed).not.toBeNull()
    expect(r37.seed!.templateId).toBe('tpl-jp-1r-37')
    // 1K 37㎡：不允许错误命中 1R 模板；1K 参照面积段（22/26）又够不着 37 → 落空。
    const trace: string[] = []
    const k37 = seedFromBrief('1K 37㎡', 单室(37), trace)
    expect(k37.seed).toBeNull()
    expect(trace.some(line => line.startsWith('tpl-jp-1r-37') && line.includes('roomProgram mismatch'))).toBe(true)
  })

  test('普通 1K 25㎡（无地块约束）命中縦长廊下 1K 参照——该形态是 1K 的典型形态', () => {
    const { seed, strategy } = seedFromBrief('1K 25㎡', {
      targetTotalAreaSqm: 25,
      rooms: [
        { id: 'bedroom-1', name: '洋室', type: 'bedroom' },
        { id: 'kitchen-1', name: 'キッチン', type: 'kitchen' },
      ],
    })
    expect(strategy.typology === 'narrow_lot').toBe(false)
    expect(seed).not.toBeNull()
    expect(seed!.templateId).toBe('tpl-jp-1k-26')
  })

  test('明确独立厨房的 2LDK 58㎡ 命中独立厨房变体 tpl-jp-2ldk-58', () => {
    const { seed, intent } = seedFromBrief('2LDK 58㎡，要独立厨房', {
      targetTotalAreaSqm: 58,
      rooms: [
        { id: 'bedroom-1', name: '主寝室', type: 'bedroom' },
        { id: 'bedroom-2', name: '洋室', type: 'bedroom' },
        { id: 'living-1', name: 'リビング', type: 'living' },
        { id: 'dining-1', name: 'ダイニング', type: 'dining' },
        { id: 'kitchen-1', name: 'キッチン', type: 'kitchen' },
      ],
    })
    // LD 合一、K 独立。
    expect(intent.rooms.some(room => room.type === 'dining')).toBe(false)
    expect(intent.rooms.some(room => room.type === 'kitchen')).toBe(true)
    expect(seed).not.toBeNull()
    expect(seed!.templateId).toBe('tpl-jp-2ldk-58')
  })

  test('trace 记录候选拒绝原因（仅诊断数据，不给用户）', () => {
    const trace: string[] = []
    const { seed } = seedFromBrief('4LDK 90㎡', {
      targetTotalAreaSqm: 90,
      rooms: [
        { id: 'bedroom-1', name: '主卧', type: 'bedroom' },
        { id: 'bedroom-2', name: '次卧', type: 'bedroom' },
        { id: 'bedroom-3', name: '客卧', type: 'bedroom' },
        { id: 'bedroom-4', name: '儿童房', type: 'bedroom' },
        { id: 'lk-1', name: 'LDK', type: 'living_kitchen' },
      ],
    }, trace)
    expect(seed).toBeNull()
    expect(trace.length).toBeGreaterThan(0)
    expect(trace.some(line => line.includes('bedroom count mismatch'))).toBe(true)
  })
})

describe('Codex review 修复回归（1K 偏航形态 / 独立厨房冲突形态 / SLDK）', () => {
  test('1K 25㎡：模型偏航输出 bedroom+living_kitchen，归一后仍命中 tpl-jp-1k-26', () => {
    const { seed, intent } = seedFromBrief('1K 25㎡', {
      targetTotalAreaSqm: 25,
      rooms: [
        { id: 'bedroom-1', name: '洋室', type: 'bedroom' },
        { id: 'lk-1', name: 'LDK', type: 'living_kitchen' },
      ],
    })
    expect(intent.rooms.some(room => room.type === 'kitchen')).toBe(true)
    expect(intent.rooms.some(room => room.type === 'living_kitchen')).toBe(false)
    expect(seed).not.toBeNull()
    expect(seed!.templateId).toBe('tpl-jp-1k-26')
  })

  test('独立厨房 2LDK：模型输出 living_kitchen(LDK)+kitchen 冲突形态仍命中 tpl-jp-2ldk-58', () => {
    const { seed, intent } = seedFromBrief('2LDK 58㎡，要独立厨房', {
      targetTotalAreaSqm: 58,
      rooms: [
        { id: 'bedroom-1', name: '主寝室', type: 'bedroom' },
        { id: 'bedroom-2', name: '洋室', type: 'bedroom' },
        { id: 'lk-1', name: 'LDK', type: 'living_kitchen' },
        { id: 'kitchen-1', name: 'キッチン', type: 'kitchen' },
      ],
    })
    expect(intent.rooms.some(room => room.type === 'living_kitchen')).toBe(false)
    expect(seed).not.toBeNull()
    expect(seed!.templateId).toBe('tpl-jp-2ldk-58')
  })

  test('2SLDK 保留 base program + S 约束，并拒绝没有服务间的普通 2LDK 种子', () => {
    const trace: string[] = []
    const { seed, strategy, intent } = seedFromBrief('2SLDK 60㎡', {
      targetTotalAreaSqm: 60,
      rooms: [
        { id: 'bedroom-1', name: '主卧', type: 'bedroom' },
        { id: 'bedroom-2', name: '次卧', type: 'bedroom' },
        { id: 'lk-1', name: 'LDK', type: 'living_kitchen' },
      ],
    }, trace)
    expect(strategy.roomProgram).toBe('2ldk')
    expect(strategy.serviceRoomCount).toBe(1)
    expect(intent.rooms.some(room => room.type === 'storage' && room.name === '納戸')).toBe(true)
    expect(seed).toBeNull()
    expect(trace.some(line => line.includes('service room count below floor'))).toBe(true)
  })

  test('1SLDK 狭长户型可命中库里明确带納戸的参照', () => {
    const { seed, strategy } = seedFromBrief('狭长户型，1SLDK 54㎡', {
      targetTotalAreaSqm: 54,
      rooms: [
        { id: 'bedroom-1', name: '洋室', type: 'bedroom' },
        { id: 'lk-1', name: 'LDK', type: 'living_kitchen' },
      ],
    })
    expect(strategy.typology).toBe('narrow_lot')
    expect(strategy.serviceRoomCount).toBe(1)
    expect(seed?.templateId).toBe('tpl-jp-1ldk-54-unagi')
    expect(seed?.plan.rooms.some(room => room.type === 'storage' && room.name === '納戸')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// 模板库容错（Codex 审阅 Suggestion 2，2026-07-17）：单个损坏 JSON 不允许
// 清空整个库并把空结果缓存住。
// ---------------------------------------------------------------------------

import { copyFileSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { invalidateTemplateCache, loadTemplates } from './template-seed'

describe('模板库逐文件容错', () => {
  test('损坏 JSON 只跳过该文件，其余照常加载，失败进 seed trace', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tpl-fault-'))
    copyFileSync(
      join(import.meta.dir, '..', 'templates', 'good', 'tpl-jp-2ldk-60-tanoji.json'),
      join(dir, 'tpl-jp-2ldk-60-tanoji.json'),
    )
    writeFileSync(join(dir, 'broken.json'), '{ this is not json')
    const records = loadTemplates(dir)
    expect(records).toHaveLength(1)
    expect(records[0]!.id).toBe('tpl-jp-2ldk-60-tanoji')

    const trace: string[] = []
    const seed = findTemplateSeed(二LDK, JP_NORM_PROFILE, undefined, { templatesDir: dir, trace })
    expect(seed).not.toBeNull()
    expect(seed!.templateId).toBe('tpl-jp-2ldk-60-tanoji')
    expect(trace.some(line => line.includes('template load failure') && line.includes('broken.json'))).toBe(true)
  })

  test('invalidateTemplateCache 后新增模板无需重启即可见', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tpl-cache-'))
    writeFileSync(join(dir, 'broken.json'), 'not json either')
    expect(loadTemplates(dir)).toHaveLength(0)
    // 修好文件但缓存仍是旧的空库。
    copyFileSync(
      join(import.meta.dir, '..', 'templates', 'good', 'tpl-jp-2ldk-60-tanoji.json'),
      join(dir, 'broken.json'),
    )
    expect(loadTemplates(dir)).toHaveLength(0)
    invalidateTemplateCache(dir)
    expect(loadTemplates(dir)).toHaveLength(1)
  })
})

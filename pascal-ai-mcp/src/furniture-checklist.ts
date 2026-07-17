// ---------------------------------------------------------------------------
// Per-room-type required furniture checklists (GENERATION_REDESIGN.md §4).
// Shared by the completion gates (batch A: detect what's missing from placed
// item names) and the furniture executor (batch C: `searchTerms` drive
// search_assets, compact variants preferred). A requirement is satisfied when
// ANY of its options matches — e.g. bathroom needs 淋浴 OR 浴缸.
// ---------------------------------------------------------------------------

import type { RoomType } from './layout-plan'

export type FurnitureOption = {
  label: string
  // Queries for search_assets, tried in order (批次 C).
  searchTerms: string[]
  // Detects the item among already-placed scene items by name (CN/EN).
  match: RegExp
}

export type FurnitureRequirement = {
  key: string
  label: string
  options: FurnitureOption[]
}

function single(key: string, label: string, searchTerms: string[], match: RegExp): FurnitureRequirement {
  return { key, label, options: [{ label, searchTerms, match }] }
}

// searchTerms are English-first: the built-in MCP catalog names and tags are
// English, so a Chinese lead term is a guaranteed-empty query the executor
// pays for on every run. Chinese terms stay as trailing fallbacks for a
// future localized catalog.
// Item-name matchers are trilingual (中/日/英): catalog items are English
// today, but modify-path scenes can contain user-named items in any language.
const BEDROOM: FurnitureRequirement[] = [
  // 床头柜/床垫 must not satisfy the bed requirement.
  single('bed', '床', ['bed', '双人床', '床'], /\bbed\b|ベッド|(?<![头铺沙发]|床头)床(?!头|垫|品)/iu),
  single('wardrobe', '衣柜', ['wardrobe', '衣柜'], /衣柜|衣橱|wardrobe|closet|タンス|箪笥|ワードローブ|クローゼット/i),
]

const LIVING: FurnitureRequirement[] = [
  single('sofa', '沙发', ['sofa', '沙发'], /沙发|sofa|couch|ソファ/i),
  single('coffee_table', '茶几', ['coffee table', '茶几'], /茶几|coffee[-_ ]?table|ローテーブル|センターテーブル/i),
]

const KITCHEN: FurnitureRequirement[] = [
  single('sink_counter', '水槽柜', ['kitchen sink', '水槽柜', '水槽'], /水槽|洗菜|\bsink\b|シンク|流し台/i),
  single('stove', '灶台', ['stove', 'cooktop', '灶台', '燃气灶'], /灶|炉(?!具架)|stove|cooktop|\brange\b|コンロ/i),
  single('fridge', '冰箱', ['fridge', '冰箱'], /冰箱|fridge|refrigerator|冷蔵庫/i),
]

// 洁具主体 matcher 必须挡住同名配件（2026-07-16 线上事故：search_assets
// 按 tag/子串命中 toilet-paper / shower-rug，rank 又偏爱小件，厕纸和地垫
// 被当成马桶和淋浴放进场景且 gate 判过）。负向前瞻只列配件词——真正的
// 洁具主体（wall-hung-toilet、shower cabin、walk-in shower）不受影响。
const TOILET_MATCH =
  /马桶|坐便|toilet(?![-_ ]?(?:paper|roll|brush|holder|seat|lid))|\bwc\b|トイレ(?!ット|ブラシ|ペーパー|カバー)|便器/i
const SHOWER_MATCH =
  /淋浴(?!垫|帘|头|喷)|shower(?![-_ ]?(?:rug|mat|curtain|caddy|head|hose|shelf|holder))|シャワー(?!マット|カーテン|ヘッド|ホース|ラック)/i

const BATHROOM: FurnitureRequirement[] = [
  single('toilet', '马桶', ['toilet', '马桶'], TOILET_MATCH),
  single('washbasin', '洗手台', ['bathroom vanity', 'basin', '洗手台', '浴室柜'], /洗手台|洗手盆|台盆|浴室柜|basin|vanity|洗面台/i),
  {
    key: 'shower_or_bathtub',
    label: '淋浴或浴缸',
    options: [
      { label: '淋浴', searchTerms: ['shower', '淋浴房', '淋浴'], match: SHOWER_MATCH },
      { label: '浴缸', searchTerms: ['bathtub', '浴缸'], match: /浴缸|bathtub(?![-_ ]?(?:mat|tray))|\btub\b|浴槽|バスタブ/i },
    ],
  },
]

const STUDY: FurnitureRequirement[] = [
  single('desk', '书桌', ['desk', '书桌', '办公桌'], /书桌|办公桌|写字台|desk|デスク|勉強机/i),
  single('office_chair', '办公椅', ['office chair', '办公椅'], /办公椅|转椅|office[-_ ]?chair|desk[-_ ]?chair|オフィスチェア|椅子(?!.*(食卓|ダイニング))/i),
]

const CHECKLISTS: Partial<Record<RoomType, FurnitureRequirement[]>> = {
  bedroom: BEDROOM,
  living: LIVING,
  kitchen: KITCHEN,
  bathroom: BATHROOM,
  study: STUDY,
  living_kitchen: [...LIVING, ...KITCHEN],
}

// J6-lite（方案 B，2026-07-16 模板种子接入需要）：卫浴分离的房间按名字拆
// 清单——トイレ只要马桶、洗面(脱衣)室只要洗手台、浴室只要淋浴/浴缸；泛称
// 卫生间保持全套。仅凭房名分不清中文泛称和日式卫浴分离（zh 老场景把完整
// 卫生间叫「浴室/厕所」很常见），所以含糊的中文词条只在 jp 市场档下生效
// （jpOnlyPattern）；假名/明确英文词条不受市场限制。
const BATHROOM_SUBKINDS: Array<{ pattern: RegExp; jpOnlyPattern?: RegExp; keys: string[] }> = [
  { pattern: /トイレ|便所|\bwc\b/i, jpOnlyPattern: /厕所|廁所/i, keys: ['toilet'] },
  { pattern: /洗面|脱衣|washroom|powder/i, keys: ['washbasin'] },
  { pattern: /風呂|バス(?!ケ)|浴槽/i, jpOnlyPattern: /浴室|\bbath\b/i, keys: ['shower_or_bathtub'] },
]

function bathroomRequirements(roomName: string, market?: string): FurnitureRequirement[] {
  // 组合式卫浴名（「浴室・トイレ」「浴室・洗面」等 unit bath 标注）命中多个
  // 子类型——取全部命中的并集，绝不能按第一个词缩成单项（否则组合间只放
  // 马桶、淋浴静默丢失，且 gate 与 executor 共用此判断会双双漏过）。
  const keys = new Set<string>()
  for (const subKind of BATHROOM_SUBKINDS) {
    const hit = subKind.pattern.test(roomName)
      || (market === 'jp' && subKind.jpOnlyPattern?.test(roomName))
    if (hit) for (const key of subKind.keys) keys.add(key)
  }
  if (keys.size === 0) return BATHROOM
  return BATHROOM.filter(requirement => keys.has(requirement.key))
}

// `market` is the NormProfile id ('jp'/'default') of the session that built
// the scene — it gates the ambiguous zh sub-kind tokens above.
export function requiredFurnitureFor(type: RoomType, roomName?: string, market?: string): FurnitureRequirement[] {
  if (type === 'bathroom' && roomName) return bathroomRequirements(roomName, market)
  return CHECKLISTS[type] ?? []
}

// Vocabulary lookup for the modify path: the op translator emits short
// generic terms in the user's language (「床」「书桌」), but the MCP catalog
// is English-only — this maps such a term to the checklist option that owns
// its trilingual matcher and English-first search terms. Returns null for
// terms outside the checklist vocabulary (caller falls back to the raw term).
export function findVocabularyOption(term: string): FurnitureOption | null {
  const trimmed = term.trim()
  if (!trimmed) return null
  for (const requirements of Object.values(CHECKLISTS)) {
    for (const requirement of requirements) {
      for (const option of requirement.options) {
        if (option.match.test(trimmed) || option.searchTerms.includes(trimmed.toLowerCase())) {
          return option
        }
      }
    }
  }
  return null
}

// Which checklist requirements did this (just deleted) item satisfy? Feeds
// the modify gates' intent exemption: an item removed at the user's explicit
// request must not resurface as "the AI failed to equip the room" — the gate
// failure whose requirement this item used to fulfil is waived for that turn.
export function requirementLabelsSatisfiedBy(itemName: string): string[] {
  const labels = new Set<string>()
  for (const requirements of Object.values(CHECKLISTS)) {
    for (const requirement of requirements) {
      if (requirement.options.some(option => option.match.test(itemName))) {
        labels.add(requirement.label)
      }
    }
  }
  return [...labels]
}

// Which requirements are NOT satisfied by the given item names. `roomName`
// activates the J6-lite bathroom sub-kind split above.
export function findMissingFurniture(
  type: RoomType,
  itemNames: string[],
  roomName?: string,
  market?: string,
): FurnitureRequirement[] {
  return requiredFurnitureFor(type, roomName, market).filter(requirement =>
    !itemNames.some(name => requirement.options.some(option => option.match.test(name))),
  )
}

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

const BATHROOM: FurnitureRequirement[] = [
  single('toilet', '马桶', ['toilet', '马桶'], /马桶|坐便|toilet|\bwc\b|トイレ|便器/i),
  single('washbasin', '洗手台', ['bathroom vanity', 'basin', '洗手台', '浴室柜'], /洗手台|洗手盆|台盆|浴室柜|basin|vanity|洗面台/i),
  {
    key: 'shower_or_bathtub',
    label: '淋浴或浴缸',
    options: [
      { label: '淋浴', searchTerms: ['shower', '淋浴房', '淋浴'], match: /淋浴|shower|シャワー/i },
      { label: '浴缸', searchTerms: ['bathtub', '浴缸'], match: /浴缸|bathtub|\btub\b|浴槽|バスタブ/i },
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

export function requiredFurnitureFor(type: RoomType): FurnitureRequirement[] {
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

// Which requirements are NOT satisfied by the given item names.
export function findMissingFurniture(
  type: RoomType,
  itemNames: string[],
): FurnitureRequirement[] {
  return requiredFurnitureFor(type).filter(requirement =>
    !itemNames.some(name => requirement.options.some(option => option.match.test(name))),
  )
}

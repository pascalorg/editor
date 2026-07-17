// ---------------------------------------------------------------------------
// Trilingual (zh / en / ja) room-name vocabulary — the single source of truth
// for every "guess the room type from its name" decision in the pipeline.
//
// Background: room NAMES travel through the system in the user's language
// (intent room names → create_room → zone names), while all logic runs on the
// RoomType enum. Four modules used to keep their own zh/en regexes for the
// name→type guess (agent.ts, completion-gates.ts, layout-metrics.ts,
// eval/assertions); Japanese input silently fell through every one of them
// (寝室/リビング/キッチン/窓 matched nothing). Adding a language now means
// editing THIS table only.
//
// Name matching is the FALLBACK path: freshly generated scenes carry
// zoneId→RoomType mappings from the plan (see WorkflowSession.zoneRoomTypes)
// and never guess. These patterns serve brief-fact matching, modify-path /
// legacy scenes, and the eval harness.
// ---------------------------------------------------------------------------

import type { RoomType } from '../layout-plan'

// Combined living+kitchen names must resolve before their parts ("客厅/开放式
// 厨房", "リビングダイニングキッチン", "2LDK の LDK"), otherwise the 厨房/
// キッチン substring misclassifies the whole open-plan zone as a kitchen.
export const LIVING_KITCHEN_PATTERN =
  /(客厅|起居|living|リビング|居間)[^,;，；]*(厨房|kitchen|キッチン|台所)|开放式?厨房|living[-_ ]?kitchen|\bldk\b|オープンキッチン|客餐厨|餐厨一体/i

export const WINDOW_PATTERN = /窗|window|窓/i

// Per-type name patterns. Notes on the less obvious entries:
// - bedroom 卧 (not 卧室): 主卧/次卧/客卧 carry no 室; ja 洋室/和室 are the
//   standard listing terms for (multi-purpose) private rooms.
// - bathroom includes ja 洗面/脱衣 (washroom) and トイレ — 方案 B keeps them
//   all under `bathroom` until the JP norm profile splits the checklist.
// - hall\b stays word-bounded so "hallway" matches but "hall" inside other
//   words doesn't false-positive.
export const ROOM_NAME_PATTERNS: Record<Exclude<RoomType, 'other' | 'living_kitchen'>, RegExp> = {
  bedroom: /卧|睡房|bedroom|寝室|洋室|和室|ベッドルーム/i,
  living: /客厅|起居|大厅|living|リビング|居間/i,
  dining: /餐厅|饭厅|dining|ダイニング|食堂/i,
  kitchen: /厨房|kitchen|キッチン|台所/i,
  bathroom: /卫生间|浴室|洗手间|卫浴|[主客公次]卫|bathroom|風呂|バス(?!ケ)|トイレ|便所|洗面|脱衣|\bwc\b/i,
  study: /书房|书斋|study|office|書斎/i,
  hallway: /走廊|过道|corridor|hallway|\bhall\b|廊下/i,
  entry: /玄关|门厅|entry|foyer|玄関/i,
  storage: /储物|储藏|衣帽|storage|closet|walk-?in|収納|納戸|押入|クローゼット|ウォークイン/i,
  balcony: /阳台|balcony|バルコニー|ベランダ/i,
}

// DK（ダイニングキッチン）vs LDK: a living_kitchen room NAMED as a DK gets
// the smaller DK area tier (NORMS_PROFILE_DESIGN.md §2.3) — real 2DK listings
// run 6–8帖 where the LDK ladder starts at 8–10帖. LDK-ish names are excluded
// first so リビングダイニングキッチン / "LDK" never downgrade.
export function isDiningKitchenName(name: string): boolean {
  // NFKC 先行：全角「１ＤＫ/ＬＤＫ」归一成半角再匹配；中点/空格分隔的
  // 「ダイニング・キッチン」也是同一个词。
  const normalized = name.normalize('NFKC')
  if (LIVING_KITCHEN_PATTERN.test(normalized)) return false
  return /ダイニング[・･\s]*キッチン|(?<![a-z])dk\b/i.test(normalized)
}

export function roomNamePattern(type: RoomType): RegExp | null {
  if (type === 'living_kitchen') return LIVING_KITCHEN_PATTERN
  if (type === 'other') return null
  return ROOM_NAME_PATTERNS[type]
}

// Canonical name→type classification. Order matters and is shared by every
// consumer: combined types first, circulation before bedroom (a "廊下" or
// entry hall must never be private), service rooms before the broad living
// match.
export function classifyRoomTypeByName(name: string): RoomType {
  if (LIVING_KITCHEN_PATTERN.test(name)) return 'living_kitchen'
  if (ROOM_NAME_PATTERNS.hallway.test(name)) return 'hallway'
  if (ROOM_NAME_PATTERNS.entry.test(name)) return 'entry'
  // Service rooms resolve BEFORE the broad /卧/ match: 「主卧卫生间」is a
  // bathroom and 「主卧步入式衣帽间」is storage — the bedroom prefix only
  // says whose it is (case-11 counted three dressing rooms as bedrooms).
  if (ROOM_NAME_PATTERNS.bathroom.test(name)) return 'bathroom'
  if (ROOM_NAME_PATTERNS.storage.test(name)) return 'storage'
  if (ROOM_NAME_PATTERNS.bedroom.test(name)) return 'bedroom'
  if (ROOM_NAME_PATTERNS.kitchen.test(name)) return 'kitchen'
  // living before dining: a combined name（「客厅兼餐厅」）is a living room
  // that also serves meals, not a dining room that swallowed the living
  // room — pure 「餐厅」 names carry no living wording and still hit dining.
  if (ROOM_NAME_PATTERNS.living.test(name)) return 'living'
  if (ROOM_NAME_PATTERNS.dining.test(name)) return 'dining'
  if (ROOM_NAME_PATTERNS.study.test(name)) return 'study'
  if (ROOM_NAME_PATTERNS.storage.test(name)) return 'storage'
  if (ROOM_NAME_PATTERNS.balcony.test(name)) return 'balcony'
  return 'other'
}

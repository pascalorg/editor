// ---------------------------------------------------------------------------
// Trilingual (zh / ja / en) vocabulary for strategy-layer brief facts
// (LAYOUT_STRATEGY_DESIGN.md §5). Same policy as room-vocab.ts: adding a
// language means editing THIS table only.
// ---------------------------------------------------------------------------

// Explicit open-kitchen wording ONLY. A bare "LDK"/"2LDK" token is NOT a
// user kitchen preference — the room program pipeline owns hub-form
// implications (kitchenModeSource 'program'), and treating the token as an
// explicit 'user' preference let a 现状 2LDK in a renovation brief masquerade
// as an open-kitchen demand for a 1K target (Codex 复审 #2). The spelled-out
// リビングダイニングキッチン stays: writing the full phrase is a real ask.
const OPEN_KITCHEN_PATTERN =
  /开放式?厨房|开敞厨房|オープンキッチン|対面キッチン|\bopen(?:-| )?(?:plan )?kitchen\b|リビングダイニングキッチン/i

// Explicit closed/independent-kitchen wording.
const CLOSED_KITCHEN_PATTERN =
  /独立厨房|封闭式?厨房|独立型?キッチン|クローズドキッチン|\b(?:separate|closed|independent) kitchen\b/i

// Closed wins on conflict: a brief that says both (e.g. corrects itself)
// most often ends on the explicit restriction, and closed is the safer
// interpretation (the model prompt can still merge if the user re-confirms).
export function detectKitchenPreference(text: string): 'open' | 'closed' | undefined {
  if (CLOSED_KITCHEN_PATTERN.test(text)) return 'closed'
  if (OPEN_KITCHEN_PATTERN.test(text)) return 'open'
  return undefined
}

// --- Japanese room-program shorthand (2DK / 1LDK / 1R / 1K) -------------------

// The canonical program the whole pipeline carries (brief → strategy →
// intent normalization → template matcher). Deliberately NOT re-derived from
// model-generated room names downstream — the model may split a DK into
// dining+kitchen, and the matcher must still know what the user asked for.
export type JapaneseRoomProgram = '1r' | '1k' | `${number}dk` | `${number}ldk`

// NFKC first: full-width ２ＬＤＫ normalizes to 2LDK. "S" (サービスルーム,
// 2SLDK/1SDK) parses STRUCTURED: the base program is kept ('2sldk' → '2ldk')
// and the S surfaces as serviceRoomCount — dropping the whole token made the
// request program-less and let it seed a plain LDK template with no service
// room (Codex 复审 #1). K/R only exist as 1K/1R in the v1 type — a "2K"
// stays undetected rather than mis-normalized. Lookarounds keep
// "10k"/"x2LDKy" from matching.
const ROOM_PROGRAM_PATTERN = /(?<![a-z0-9])([1-9])\s*(s?ldk|s?dk|k|r)(?![a-z])/i

export type RoomProgramParse = {
  program: JapaneseRoomProgram
  // サービスルーム/納戸 count implied by an S in the token. The v1 room-program
  // type can't carry it inline, so it rides beside the base program: prompt
  // demands the 納戸, and the template matcher refuses to seed (no SLDK
  // references exist — a plain LDK hit would silently drop the room).
  serviceRoomCount: number
}

export function parseRoomProgram(text: string): RoomProgramParse | undefined {
  const normalized = text.normalize('NFKC')
  if (/ワンルーム/.test(normalized)) return { program: '1r', serviceRoomCount: 0 }
  const match = ROOM_PROGRAM_PATTERN.exec(normalized)
  if (!match) return undefined
  const count = Number(match[1])
  let form = match[2]!.toLowerCase()
  const serviceRoomCount = form.startsWith('s') ? 1 : 0
  if (serviceRoomCount > 0) form = form.slice(1)
  if (form === 'k' || form === 'r') {
    return count === 1 ? { program: `1${form}` as JapaneseRoomProgram, serviceRoomCount } : undefined
  }
  return { program: `${count}${form}` as JapaneseRoomProgram, serviceRoomCount }
}

export function detectRoomProgram(text: string): JapaneseRoomProgram | undefined {
  return parseRoomProgram(text)?.program
}

// A service room (S in SLDK/SDK) is not an ordinary closet. Both strategy
// repair and template matching use this one vocabulary gate so a クローゼット
// can never silently satisfy a demanded 納戸.
const SERVICE_ROOM_NAME_PATTERN =
  /納戸|サービス(?:ルーム|室)|Sルーム|service\s*room|\bden\b|服务(?:间|房)|多功能室/i

export function isServiceRoomName(name: string): boolean {
  return SERVICE_ROOM_NAME_PATTERN.test(name.normalize('NFKC'))
}

// The hub room a DK/LDK program implies; 1R/1K (and no program) have none.
export function roomProgramHub(program: JapaneseRoomProgram | undefined): 'DK' | 'LDK' | undefined {
  if (!program) return undefined
  if (program.endsWith('ldk')) return 'LDK'
  if (program.endsWith('dk')) return 'DK'
  return undefined
}

// --- site dimensions (S3 narrow_lot pipeline) --------------------------------

const NUM = String.raw`(\d+(?:[.．]\d+)?)`
const METER = String.raw`(?:米|ｍ|m|メートル|meters?)`

// "5米×18米" / "5m x 18m" / "5×18m" — a unit must appear on at least one side
// so "3x2 bedrooms" never matches.
const DIM_PAIR_PATTERN = new RegExp(
  `${NUM}\\s*${METER}?\\s*[x×＊*]\\s*${NUM}\\s*${METER}(?![a-z])|${NUM}\\s*${METER}\\s*[x×＊*]\\s*${NUM}`,
  'i',
)
// Labelled pairs, order-free: 宽5米…长18米 / 幅5m…奥行18m / 5m wide … 18m long.
const WIDTH_PATTERN = new RegExp(`(?:宽|寬|幅|間口)\\s*${NUM}\\s*${METER}|${NUM}\\s*${METER}\\s+wide`, 'i')
const LENGTH_PATTERN = new RegExp(`(?:长|長さ?|奥行き?|進深|深)\\s*${NUM}\\s*${METER}|${NUM}\\s*${METER}\\s+(?:long|deep)`, 'i')

const plausible = (v: number) => v >= 2 && v <= 100

// Deterministic lot-dimension extraction. Returned as written — the caller
// decides which side is the short one.
export function detectSiteHint(text: string): { widthM: number; depthM: number } | undefined {
  const pair = DIM_PAIR_PATTERN.exec(text)
  if (pair) {
    const nums = pair.slice(1).filter(Boolean).map(Number)
    if (nums.length === 2 && nums.every(plausible)) return { widthM: nums[0]!, depthM: nums[1]! }
  }
  const w = WIDTH_PATTERN.exec(text)
  const l = LENGTH_PATTERN.exec(text)
  if (w && l) {
    const width = Number(w[1] ?? w[2])
    const depth = Number(l[1] ?? l[2])
    if (plausible(width) && plausible(depth)) return { widthM: width, depthM: depth }
  }
  return undefined
}

// Explicit narrow-lot wording (design doc §3.2: "brief 明示长条地块").
const NARROW_LOT_PATTERN =
  /狭长|窄长|长条(?:形?地块|地皮)?|細長|狭小間口|うなぎの寝床|\bnarrow (?:lot|plot|site)\b|\blong,? narrow\b/i

export function detectNarrowLot(text: string): boolean {
  return NARROW_LOT_PATTERN.test(text)
}

// Explicit L-shape wording (design doc §3.2, S5). "L形/L型/L字" also written
// full-width in ja/zh briefs.
const L_SHAPE_PATTERN = /[LＬl]\s*[形型字]|\bL[-\s]?shaped?\b|エル字/

export function detectLShape(text: string): boolean {
  return L_SHAPE_PATTERN.test(text)
}

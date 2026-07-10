// ---------------------------------------------------------------------------
// Trilingual (zh / ja / en) vocabulary for strategy-layer brief facts
// (LAYOUT_STRATEGY_DESIGN.md §5). Same policy as room-vocab.ts: adding a
// language means editing THIS table only.
// ---------------------------------------------------------------------------

// Explicit open-kitchen wording. "LDK" counts: by definition the kitchen is
// part of the combined living space (2LDK briefs imply it without saying
// オープン).
// "LDK" may follow a digit ("2LDK") where \b doesn't fire — exclude only
// letters around it.
const OPEN_KITCHEN_PATTERN =
  /开放式?厨房|开敞厨房|オープンキッチン|対面キッチン|\bopen(?:-| )?(?:plan )?kitchen\b|(?<![a-z])ldk(?![a-z])|リビングダイニングキッチン/i

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

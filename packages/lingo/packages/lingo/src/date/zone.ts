// Timezone detection for the date parser (plan 030). Zero-dep: explicit
// offsets and a curated abbreviation table are pure data; IANA names resolve
// their DST-correct offset via `Intl` (allowed). Detection is exposed on the
// result by default (civil instant kept); `applyZone` converts to a UTC instant.

/** A timezone detected in the input. */
export interface DateZone {
  /** The abbreviation, when the input was one. */
  abbreviation?: string
  /** `true` when the written form maps to more than one real zone (all abbreviations). */
  ambiguous?: boolean
  /** `true` when the offset was applied to produce a UTC instant (`applyZone`). */
  applied: boolean
  /** IANA id, when the input was an IANA name. */
  iana?: string
  /** Minutes east of UTC for the parsed instant (EST = −300, IST = +330). */
  offsetMinutes: number
  /** How the zone was written. */
  source: 'offset' | 'abbrev' | 'iana' | 'named'
  /** The zone text as it appeared ("EST", "+05:30", "Europe/Paris"). */
  text: string
}

// Curated common abbreviations → their STANDARD/most-recognized offset (minutes).
// Every abbreviation is ambiguous in principle (EST is US −5 OR AU +10; IST is
// India/Irish/Israel), so callers get `ambiguous: true` and should prefer an
// explicit offset or IANA name for correctness.
const ABBREV: Readonly<Record<string, number>> = {
  UT: 0,
  GMT: 0,
  UTC: 0,
  Z: 0,
  WET: 0,
  BST: 60,
  IST: 330, // India (most common); also Irish +60 / Israel +120 → ambiguous
  CET: 60,
  CEST: 120,
  EET: 120,
  EEST: 180,
  MSK: 180,
  JST: 540,
  KST: 540,
  AEST: 600,
  AEDT: 660,
  NZST: 720,
  HST: -600,
  AKST: -540,
  AKDT: -480,
  PST: -480,
  PDT: -420,
  MST: -420,
  MDT: -360,
  CST: -360, // US Central (also China +480 / Cuba −5) → ambiguous
  CDT: -300,
  EST: -300,
  EDT: -240,
  AST: -240,
  ADT: -180,
  NST: -210,
  BRT: -180,
}

// Common named zones → an IANA id, resolved via Intl for the parsed instant.
const NAMED: Readonly<Record<string, string>> = {
  eastern: 'America/New_York',
  central: 'America/Chicago',
  mountain: 'America/Denver',
  pacific: 'America/Los_Angeles',
  'eastern time': 'America/New_York',
  'central time': 'America/Chicago',
  'mountain time': 'America/Denver',
  'pacific time': 'America/Los_Angeles',
  'uk time': 'Europe/London',
  'paris time': 'Europe/Paris',
}

/** Parse an explicit numeric offset ("+05:30", "-0800", "UTC+2", "GMT-5", "Z"). */
function parseOffsetMinutes(token: string): number | null {
  const t = token.trim().toUpperCase()
  if (t === 'Z' || t === 'UTC' || t === 'GMT' || t === 'UT') {
    return 0
  }
  const m = /^(?:UTC|GMT)?([+-])(\d{1,2})(?::?(\d{2}))?$/.exec(t)
  if (!m) {
    return null
  }
  const sign = m[1] === '-' ? -1 : 1
  const hours = Number(m[2])
  const minutes = m[3] === undefined ? 0 : Number(m[3])
  if (hours > 14 || minutes > 59) {
    return null
  }
  return sign * (hours * 60 + minutes)
}

/**
 * DST-correct offset (minutes east of UTC) for an IANA zone at `instant`, via
 * `Intl`. Returns null if the zone id is not recognized.
 */
export function ianaOffsetMinutes(iana: string, instant: Date): number | null {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: iana,
      timeZoneName: 'longOffset',
    }).formatToParts(instant)
    const name = parts.find((part) => part.type === 'timeZoneName')?.value
    if (!name) {
      return null
    }
    if (name === 'GMT' || name === 'UTC') {
      return 0
    }
    return parseOffsetMinutes(name)
  } catch {
    return null
  }
}

function isIanaName(token: string): boolean {
  return /^[A-Za-z]+(?:[/_][A-Za-z]+)+$/.test(token)
}

/**
 * Detect a timezone from a token. `instant` is the (civil) date used to resolve
 * IANA/DST offsets. Returns the zone metadata (not yet applied), or null.
 */
export function detectZone(token: string, instant: Date): DateZone | null {
  const text = token.trim()
  const upper = text.toUpperCase()
  const lower = text.toLowerCase()

  const offset = parseOffsetMinutes(text)
  if (offset !== null) {
    return { source: 'offset', text, offsetMinutes: offset, applied: false }
  }
  if (upper in ABBREV) {
    return {
      source: 'abbrev',
      text,
      offsetMinutes: ABBREV[upper]!,
      abbreviation: upper,
      ambiguous: true,
      applied: false,
    }
  }
  if (lower in NAMED) {
    const iana = NAMED[lower]!
    const mins = ianaOffsetMinutes(iana, instant)
    if (mins !== null) {
      return { source: 'named', text, offsetMinutes: mins, iana, applied: false }
    }
  }
  if (isIanaName(text)) {
    const mins = ianaOffsetMinutes(text, instant)
    if (mins !== null) {
      return { source: 'iana', text, offsetMinutes: mins, iana: text, applied: false }
    }
  }
  return null
}

const NAMED_MULTI = /\s+(eastern|central|mountain|pacific|uk|paris)\s+time$/i
const IANA_TRAIL = /\s+([A-Za-z]+(?:[/_][A-Za-z]+)+)$/
const OFFSET_TRAIL = /\s*((?:UTC|GMT)[+-]\d{1,2}(?::?\d{2})?|[+-]\d{2}:?\d{2}|Z|UTC|GMT)$/i
const ABBREV_TRAIL = /\s+([A-Za-z]{2,5})$/

/**
 * Peel a trailing timezone off a time string, validated against {@link detectZone}
 * so only real zones are stripped ("3pm EST", "15:00 +05:30", "9am Europe/Paris",
 * "3pm Pacific Time"). Returns the cleaned source + the zone, or null.
 */
export function stripTrailingZone(
  source: string,
  instant: Date,
): { source: string; zone: DateZone } | null {
  for (const re of [NAMED_MULTI, IANA_TRAIL, OFFSET_TRAIL, ABBREV_TRAIL]) {
    const m = re.exec(source)
    if (!m) {
      continue
    }
    const token = re === NAMED_MULTI ? source.slice(m.index).trim() : m[1]!
    if (/^(?:am|pm)$/i.test(token)) {
      continue
    }
    const zone = detectZone(token, instant)
    if (zone) {
      return { source: source.slice(0, m.index).trimEnd(), zone }
    }
  }
  return null
}

/**
 * Convert civil wall-clock fields (interpreted as being in `zone`) to the actual
 * UTC instant. For IANA zones this re-resolves the offset at the target instant
 * (DST-correct two-pass).
 */
export function applyZoneToCivil(civil: Date, zone: DateZone): Date {
  const utcGuess = Date.UTC(
    civil.getFullYear(),
    civil.getMonth(),
    civil.getDate(),
    civil.getHours(),
    civil.getMinutes(),
    civil.getSeconds(),
  )
  let offset = zone.offsetMinutes
  if (zone.iana) {
    // Re-resolve at the approximate instant so a DST transition uses the right offset.
    const refined = ianaOffsetMinutes(zone.iana, new Date(utcGuess - offset * 60_000))
    if (refined !== null) {
      offset = refined
    }
  }
  return new Date(utcGuess - offset * 60_000)
}

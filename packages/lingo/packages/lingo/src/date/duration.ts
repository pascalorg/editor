import { makeIssue } from '../core/errors'
import { Quantity, type QuantityPart } from '../core/quantity'
import { createRegistry, type Registry } from '../core/registry'
import type {
  IssueCode,
  LingoIssue,
  Messages,
  NumberFormatPolicy,
  Severity,
  Span,
} from '../core/types'
import { resolveLanguageProfile } from '../locale/profile'
import type { DateOffsetUnit, LocalePack } from '../locale/types'
import { parseQuantityExpr } from '../parse/grammar'
import { normalizeInput, toSourceSpan } from '../parse/normalize'
import { attachSerialization } from '../parse/serialize'
import { duration } from '../units/duration'
import type { DateFail } from './parse'
import { attachDurationSerialization, type SerializedDuration } from './serialize'
import { DURATION_UNIT_SECONDS } from './vocab'

/**
 * Options for `parseDuration()`.
 * @example
 * ```ts
 * import { parseDuration } from '@pascal-app/lingo/date'
 * parseDuration('90 min', { numberFormat: 'comma-decimal' })
 * ```
 */
export interface DurationOptions {
  escalate?: Partial<Record<IssueCode, Severity>>
  locale?: string
  localePacks?: readonly LocalePack[]
  messages?: Messages
  numberFormat?: NumberFormatPolicy
  registry?: Registry
  strictness?: 'forgiving' | 'confirm' | 'strict'
}

/**
 * A successfully parsed duration, as a `Quantity` of kind `'duration'`
 * (base seconds).
 * @example
 * ```ts
 * import { parseDuration } from '@pascal-app/lingo/date'
 * const r = parseDuration('90 min')
 * r.ok && r.duration.valueIn('h') // 1.5
 * ```
 */
export interface DurationResult {
  confidence: number
  duration: Quantity
  issues: LingoIssue[]
  ok: true
  span: Span
  text: string
  /** v3 wire shape (flat quantity fields, self-describing span) — what `JSON.stringify` emits. */
  toJSON?(): SerializedDuration
  type: 'duration'
}

let defaultDurationRegistry: Registry | undefined

function registryFor(opts?: DurationOptions): Registry {
  if (opts?.registry) {
    return opts.registry
  }
  if (opts?.locale || opts?.localePacks) {
    const reg = createRegistry([duration])
    const words = resolveLanguageProfile(opts.localePacks, opts.locale).date?.unitWords ?? {}
    for (const word of Object.keys(words)) {
      reg.registerUnitAliases('duration', durationUnitId(words[word]!), [word])
    }
    return reg
  }
  defaultDurationRegistry ??= createRegistry([duration])
  return defaultDurationRegistry
}

function trimRange(text: string): Span {
  const start = text.search(/\S/)
  if (start < 0) {
    return { start: 0, end: 0 }
  }
  let end = text.length
  while (end > start && /\s/.test(text[end - 1]!)) {
    end--
  }
  return { start, end }
}

const ISO_UNITS = [
  { key: 'Y', unit: 'yr', seconds: DURATION_UNIT_SECONDS.yr, civil: 'year' },
  { key: 'M', unit: 'mo', seconds: DURATION_UNIT_SECONDS.mo, civil: 'month' },
  { key: 'W', unit: 'wk', seconds: DURATION_UNIT_SECONDS.wk },
  { key: 'D', unit: 'd', seconds: DURATION_UNIT_SECONDS.d },
  { key: 'H', unit: 'h', seconds: DURATION_UNIT_SECONDS.h },
  { key: 'TM', unit: 'min', seconds: DURATION_UNIT_SECONDS.min },
  { key: 'S', unit: 's', seconds: DURATION_UNIT_SECONDS.s },
] as const

/**
 * Parse a duration: unit expressions ("90 min", "1h30"), ISO 8601
 * ("PT1H30M"), or clock form ("1:30"). Returns a `Quantity` (kind
 * `'duration'`) so it composes with `convert`/`format`/`humanizeDuration`.
 * @example
 * ```ts
 * import { parseDuration } from '@pascal-app/lingo/date'
 * parseDuration('PT1H30M').duration.base // 5400 (seconds)
 * ```
 */
export function parseDuration(text: string, opts?: DurationOptions): DurationResult | DateFail {
  return attachDurationSerialization(
    parseDurationImpl(text, opts) as DurationResult | DateFail<DurationResult>,
  )
}

function parseDurationImpl(text: string, opts?: DurationOptions): DurationResult | DateFail {
  const n = normalizeInput(text)
  const { start: trimStart, end: trimEnd } = trimRange(n.text)
  const span = toSourceSpan(n, trimStart, trimEnd)
  if (trimStart === trimEnd) {
    return {
      ok: false,
      text,
      issues: [makeIssue('NO_VALUE', { example: '"90 min"' }, span, opts?.messages)],
    }
  }

  const source = n.text.slice(trimStart, trimEnd)
  const iso = parseIsoDuration(source, text, span, opts)
  if (iso) {
    return iso.ok ? finishDuration(iso, opts) : iso
  }

  const colon = parseColonDuration(source, text, span, opts)
  if (colon) {
    return finishDuration(colon, opts)
  }

  return parseUnitDuration(text, opts)
}

/**
 * Parse a plain unit-expression duration ("90 min", "3 days") via the shared
 * quantity grammar — no ISO/clock forms. Split out so callers that only need
 * unit durations (anchored date ranges) tree-shake the ISO/colon machinery.
 */
export function parseUnitDuration(text: string, opts?: DurationOptions): DurationResult | DateFail {
  const q = parseQuantityExpr(text, {
    kind: 'duration',
    locale: opts?.locale,
    localePacks: opts?.localePacks,
    registry: registryFor(opts),
    numberFormat: opts?.numberFormat ?? 'auto',
    messages: opts?.messages,
  })
  if (!q.ok) {
    // Serializes as a core v3 failure (self-describing spans, quantity
    // candidate) — the grammar produced it, so its wire shape applies.
    return attachSerialization(q)
  }
  const issues = [...q.issues]
  if (usesCivilAverage(q.quantity)) {
    issues.push(
      makeIssue(
        'CIVIL_AVERAGE',
        { unit: 'month/year', detail: 'Julian average' },
        q.span,
        opts?.messages,
      ),
    )
  }
  return finishDuration(
    {
      ok: true,
      type: 'duration',
      duration: q.quantity,
      span: q.span,
      issues,
      confidence: confidence(issues, q.confidence),
      text,
    },
    opts,
  )
}

function durationUnitId(unit: DateOffsetUnit): string {
  return unit === 'minute'
    ? 'min'
    : unit === 'month'
      ? 'mo'
      : unit === 'year'
        ? 'yr'
        : unit === 'week'
          ? 'wk'
          : unit[0]!
}

function parseIsoDuration(
  source: string,
  text: string,
  span: Span,
  opts?: DurationOptions,
): DurationResult | DateFail | null {
  if (!/^p/i.test(source)) {
    return null
  }
  const m =
    /^P(?:(\d+(?:[.,]\d+)?)Y)?(?:(\d+(?:[.,]\d+)?)M)?(?:(\d+(?:[.,]\d+)?)W)?(?:(\d+(?:[.,]\d+)?)D)?(?:T(?:(\d+(?:[.,]\d+)?)H)?(?:(\d+(?:[.,]\d+)?)M)?(?:(\d+(?:[.,]\d+)?)S)?)?$/i.exec(
      source,
    )
  if (!m) {
    return failDuration(text, span, opts)
  }
  const raw = [m[1], m[2], m[3], m[4], m[5], m[6], m[7]]
  const present: number[] = []
  for (let index = 0; index < raw.length; index++) {
    if (raw[index] !== undefined) {
      present.push(index)
    }
  }
  if (present.length === 0) {
    return failDuration(text, span, opts)
  }
  const fractional = present.filter((index) => /[.,]/.test(raw[index]!))
  if (
    fractional.length > 1 ||
    (fractional.length === 1 && fractional[0] !== present[present.length - 1])
  ) {
    return failDuration(text, span, opts)
  }

  let seconds = 0
  const parts: QuantityPart[] = []
  let civil = false
  for (let i = 0; i < raw.length; i++) {
    const valueText = raw[i]
    if (valueText === undefined) {
      continue
    }
    const value = Number(valueText.replace(',', '.'))
    if (!Number.isFinite(value)) {
      return failDuration(text, span, opts)
    }
    const def = ISO_UNITS[i]!
    seconds += value * def.seconds
    parts.push({ unit: def.unit, value })
    if ('civil' in def) {
      civil = true
    }
  }

  const issues = civil
    ? [
        makeIssue(
          'CIVIL_AVERAGE',
          { unit: 'month/year', detail: 'Julian average' },
          span,
          opts?.messages,
        ),
      ]
    : []
  return {
    ok: true,
    type: 'duration',
    duration: new Quantity(registryFor(opts), 'duration', seconds, 's', { parts }),
    span,
    issues,
    confidence: confidence(issues, 1),
    text,
  }
}

function parseColonDuration(
  source: string,
  text: string,
  span: Span,
  opts?: DurationOptions,
): DurationResult | null {
  const m = /^([+-]?\d+):([0-5]\d)(?::([0-5]\d(?:[.,]\d+)?))?$/.exec(source)
  if (!m) {
    return null
  }
  const sign = m[1]!.startsWith('-') ? -1 : 1
  const hours = Math.abs(Number(m[1]))
  const minutes = Number(m[2])
  const secondsPart = m[3] === undefined ? 0 : Number(m[3].replace(',', '.'))
  const seconds = sign * (hours * 3600 + minutes * 60 + secondsPart)
  const parts: QuantityPart[] = [
    { unit: 'h', value: sign * hours },
    { unit: 'min', value: sign * minutes },
  ]
  if (m[3] !== undefined) {
    parts.push({ unit: 's', value: sign * secondsPart })
  }
  const issues =
    m[3] === undefined
      ? [
          makeIssue(
            'AMBIGUOUS_DATE',
            {
              text: source,
              a: `${hours} hour${hours === 1 ? '' : 's'} ${minutes} minute${minutes === 1 ? '' : 's'}`,
              b: `${hours} minute${hours === 1 ? '' : 's'} ${minutes} second${minutes === 1 ? '' : 's'}`,
            },
            span,
            opts?.messages,
          ),
        ]
      : []
  return {
    ok: true,
    type: 'duration',
    duration: new Quantity(registryFor(opts), 'duration', seconds, 'h', { parts }),
    span,
    issues,
    confidence: confidence(issues, 1),
    text,
  }
}

function finishDuration(
  result: DurationResult,
  opts?: DurationOptions,
): DurationResult | DateFail<DurationResult> {
  const escalate = durationEscalate(opts)
  const issues = result.issues.map((it) => {
    const severity = escalate[it.code]
    return severity && severity !== it.severity ? { ...it, severity } : it
  })
  return issues.some((it) => it.severity === 'error')
    ? { ok: false, text: result.text, issues, candidate: result }
    : { ...result, issues }
}

function durationEscalate(opts: DurationOptions | undefined): Partial<Record<IssueCode, Severity>> {
  const out: Partial<Record<IssueCode, Severity>> = {}
  if (opts?.strictness === 'confirm' || opts?.strictness === 'strict') {
    out.AMBIGUOUS_DATE = 'error'
  }
  return Object.assign(out, opts?.escalate)
}

function failDuration(text: string, span: Span, opts?: DurationOptions): DateFail {
  return {
    ok: false,
    text,
    issues: [makeIssue('NO_VALUE', { example: '"PT1H30M"' }, span, opts?.messages)],
  }
}

function usesCivilAverage(q: Quantity): boolean {
  if (q.unit === 'yr' || q.unit === 'mo') {
    return true
  }
  return q.parts?.some((part) => part.unit === 'yr' || part.unit === 'mo') ?? false
}

function confidence(issues: readonly { code: string }[], base: number): number {
  let score = base
  for (const issue of issues) {
    if (issue.code === 'AMBIGUOUS_DATE') {
      score -= 0.2
    } else if (issue.code === 'CIVIL_AVERAGE') {
      score -= 0.05
    }
  }
  return Math.max(0.05, Math.round(score * 100) / 100)
}

/**
 * Public type contract for lingo.
 * This module is a leaf: it imports nothing.
 */

/**
 * Built-in measurement kinds. Custom kinds are any other string.
 * @example
 * ```ts
 * import type { Kind } from '@pascal-app/lingo'
 * const k: Kind = 'length' // or 'mass', 'currency', 'temperature', … or a custom string
 * ```
 */
export type Kind =
  | 'length'
  | 'mass'
  | 'temperature'
  | 'duration'
  | 'volume'
  | 'area'
  | 'speed'
  | 'data'
  | 'data_rate'
  | 'flow_rate'
  | 'acceleration'
  | 'pressure'
  | 'energy'
  | 'force'
  | 'torque'
  | 'power'
  | 'frequency'
  | 'angle'
  | 'percent'
  | 'luminous_intensity'
  | 'luminous_flux'
  | 'illuminance'
  | 'luminance'
  | 'voltage'
  | 'current'
  | 'resistance'
  | 'charge'
  | 'substance'
  | 'concentration'
  | 'radiation_absorbed_dose'
  | 'radiation_equivalent_dose'
  | 'radioactivity'
  | 'currency'
  | (string & {})

/**
 * Measurement system a unit belongs to, for disambiguation ('ton') and
 * best-fit display selection. `'shared'` units (meters, seconds) match any
 * system.
 * @example
 * ```ts
 * import { convert, type UnitSystem } from '@pascal-app/lingo'
 * const sys: UnitSystem = 'us'
 * convert(1, 'gal', 'L') // 3.785411784 — US gallon (system: 'us')
 * ```
 */
export type UnitSystem = 'metric' | 'us' | 'imperial' | 'shared'

/**
 * A unit definition. Conversion to the kind's base unit is affine:
 * `base = value * factor + offset`.
 * @example
 * ```ts
 * import type { UnitDef } from '@pascal-app/lingo'
 * const foot: UnitDef = {
 *   id: 'ft', symbol: 'ft', name: 'foot', plural: 'feet',
 *   factor: 0.3048, system: 'us', aliases: ['feet'],
 * }
 * ```
 */
export interface UnitDef {
  /**
   * Case-insensitive parse aliases. `symbol`, `name` and `plural` are implied
   * aliases and need not be repeated. Store lowercase.
   */
  aliases?: readonly string[]
  /**
   * Rank for best-fit unit selection (`toBest`). Units without `best` are never
   * auto-selected. Higher value wins ties at equal magnitude fit.
   */
  best?: number
  /** Aliases matched only with exact case: 'Mm', 'Mb', 'B'. */
  caseExact?: readonly string[]
  /** Must be positive and finite. */
  factor: number
  /** Stable id, unique within its kind: 'm', 'ft', 'C', 'KiB'. */
  id: string
  /** ECMA-402 sanctioned unit identifier for Intl formatting, when one exists. */
  intl?: string
  /** Decimal places used by minor-unit currency interop. Defaults to 2 for currency units. */
  minorUnit?: number
  /** Singular long name: 'meter'. */
  name: string
  /** Affine offset in base units (temperature only in v0.1). Default 0. */
  offset?: number
  /** Plural long name. Defaults to `name + 's'`. */
  plural?: string
  /** Compound continuation hint: ft → { unit: 'in', per: 12 }; h → { unit: 'min', per: 60 }. */
  subunit?: { unit: string; per: number }
  /** Preferred display symbol: 'm', '°C', 'KiB', 'ft'. */
  symbol: string
  system: UnitSystem
}

/**
 * A measurement kind: its base unit and the units it accepts. Pass an array
 * of these to `createRegistry()` to build a bring-your-own-data registry, or
 * to `registerKind()` to extend the default one.
 * @example
 * ```ts
 * import { createRegistry, type KindDef } from '@pascal-app/lingo/core'
 * const length: KindDef = {
 *   kind: 'length',
 *   baseUnit: 'm',
 *   units: [
 *     { id: 'm', symbol: 'm', name: 'meter', factor: 1, system: 'metric' },
 *     { id: 'ft', symbol: 'ft', name: 'foot', factor: 0.3048, system: 'us' },
 *   ],
 * }
 * const reg = createRegistry([length])
 * ```
 */
export interface KindDef {
  /** Unit id of the base unit; its def must have factor 1 and no offset. */
  baseUnit: string
  kind: Kind
  /** Units are self-canonical and need caller-provided rates for cross-unit conversion. */
  rateBased?: boolean
  units: readonly UnitDef[]
}

/**
 * Preserve literal unit ids, aliases, and kind names while checking the public
 * `KindDef` shape. The returned object is the same object passed in.
 *
 * `defineKind` only DECLARES data (a typed `KindDef`) — it registers nothing.
 * Feed the result to `createRegistry()`/`createLingo({ kinds })` for an
 * isolated instance, or to `registerKind()` to mutate the shared default
 * registry.
 * @example
 * ```ts
 * import { defineKind } from '@pascal-app/lingo/core'
 * const widgets = defineKind({
 *   kind: 'widget',
 *   baseUnit: 'widget',
 *   units: [{ id: 'widget', symbol: 'widget', name: 'widget', factor: 1, system: 'shared' }],
 * })
 * ```
 */
type DefinedUnits<T extends readonly UnitDef[]> = {
  readonly [Index in keyof T]: T[Index] & UnitDef
}

type DefinedKind<T extends KindDef> = Omit<T, 'units'> & {
  readonly units: DefinedUnits<T['units']>
}

export function defineKind<const T extends KindDef>(kind: T): DefinedKind<T>
export function defineKind(kind: KindDef): KindDef {
  return kind
}

/**
 * Issue severity. `'error'` fails the parse (`ok: false`); `'warning'` and
 * `'info'` ride along on a successful result.
 * @example
 * ```ts
 * import { lingo, type Severity } from '@pascal-app/lingo'
 * const r = lingo('5 meterz', { kind: 'length' })
 * const sev: Severity | undefined = r.issues[0]?.severity // 'warning' (TYPO_CORRECTED)
 * ```
 */
export type Severity = 'error' | 'warning' | 'info'

/**
 * A half-open character range `[start, end)` into the ORIGINAL input string:
 * `start` inclusive, `end` exclusive, counted in UTF-16 code units. Every
 * result, issue, and warning carries one so you can highlight the exact text it
 * refers to — `input.slice(span.start, span.end)` is that substring.
 * @example
 * ```ts
 * import { lingo } from '@pascal-app/lingo'
 * const span = lingo('5 meterz', { kind: 'length' }).issues[0]?.span
 * span // { start: 2, end: 8 }
 * '5 meterz'.slice(span!.start, span!.end) // 'meterz' — the text that was typo-corrected
 * ```
 */
export interface Span {
  end: number
  start: number
}

/**
 * Stable identifiers for every issue lingo can raise — switch on
 * `issue.code` for programmatic handling; `formatIssue()`/the `messages`
 * option control the human copy.
 * @example
 * ```ts
 * import { lingo, firstError } from '@pascal-app/lingo'
 * const r = lingo('5 meterz', { kind: 'length', strictness: 'strict' })
 * firstError(r)?.code // 'UNKNOWN_UNIT'
 * ```
 */
export type IssueCode =
  | 'EMPTY'
  | 'NO_VALUE'
  | 'UNKNOWN_UNIT'
  | 'KIND_MISMATCH'
  | 'RANGE_KIND_MISMATCH'
  | 'CONVERSION_KIND_MISMATCH'
  | 'RATE_REQUIRED'
  | 'TRAILING_INPUT'
  | 'SINGLE_VALUE_EXPECTED'
  | 'APPROX_NOT_ALLOWED'
  | 'UNIT_REQUIRED'
  | 'CONVERSION_NOT_ALLOWED'
  | 'NUMBER_FORMAT'
  | 'NONFINITE'
  | 'LOCALE_NOT_LOADED'
  | 'RANGE_MIN'
  | 'RANGE_MAX'
  | 'RANGE_OPEN_BOUND_NOT_ALLOWED'
  | 'REQUIRED'
  | 'UNSUPPORTED_DATE'
  /**
   * `lingo/date`'s `parseDate()` only: input that depends on a reference time
   * ("in 2d", "tomorrow", "March 5", "at 3pm") was parsed without an explicit
   * `now` option. Fully absolute dates ("2026-07-04") never require it.
   */
  | 'NOW_REQUIRED'
  | 'TYPO_CORRECTED'
  | 'AMBIGUOUS_NUMBER'
  | 'AMBIGUOUS_UNIT'
  | 'AMBIGUOUS_DATE'
  | 'RANGE_REVERSED'
  | 'COMPOUND_OVERFLOW'
  | 'CIVIL_AVERAGE'
  | 'UNIT_ASSUMED'
  | 'WEEKDAY_ASSUMED_NEXT'
  | 'SLANG_UNIT'
  | 'TZ_IGNORED'
  | 'AMBIGUOUS_TIMEZONE'

/**
 * Per-code structured payload, keyed by `IssueCode` — what `issue.data`
 * contains for each code. Narrow on `issue.code` first to get the right
 * shape.
 * @example
 * ```ts
 * import { lingo } from '@pascal-app/lingo'
 * const r = lingo('5 meterz', { kind: 'length' })
 * const issue = r.issues[0]
 * if (issue?.code === 'TYPO_CORRECTED') {
 *   issue.data // { unit: 'meterz', corrected: 'm' }
 * }
 * ```
 */
export interface IssueDataMap {
  AMBIGUOUS_DATE: { text: string; a: string; b: string }
  AMBIGUOUS_NUMBER: { text: string; a: string; b: string }
  AMBIGUOUS_TIMEZONE: { tz: string }
  AMBIGUOUS_UNIT: { unit: string; assumed: string; suggestions?: string[] }
  APPROX_NOT_ALLOWED: Record<string, never>
  CIVIL_AVERAGE: { unit: string; detail: string }
  COMPOUND_OVERFLOW: { value: number; unit: string }
  CONVERSION_KIND_MISMATCH: { found: string; target: string }
  CONVERSION_NOT_ALLOWED: Record<string, never>
  EMPTY: Record<string, never>
  KIND_MISMATCH: { found: string; expected: string; example: string }
  LOCALE_NOT_LOADED: { locale: string }
  NO_VALUE: { example: string }
  NONFINITE: Record<string, never>
  NOW_REQUIRED: Record<string, never>
  NUMBER_FORMAT: { text: string }
  RANGE_KIND_MISMATCH: { left: string; right: string }
  RANGE_MAX: { max: string }
  RANGE_MIN: { min: string }
  RANGE_OPEN_BOUND_NOT_ALLOWED: { missing: 'min' | 'max' }
  RANGE_REVERSED: { fixed: string }
  RATE_REQUIRED: { from: string; to: string }
  REQUIRED: Record<string, never>
  SINGLE_VALUE_EXPECTED: Record<string, never>
  SLANG_UNIT: { alias: string; unit: string }
  TRAILING_INPUT: { text: string }
  TYPO_CORRECTED: { unit: string; corrected: string }
  TZ_IGNORED: { tz: string }
  UNIT_ASSUMED: { unit: string }
  UNIT_REQUIRED: { example: string }
  UNKNOWN_UNIT: { unit: string; suggestions?: string[] }
  UNSUPPORTED_DATE: { example: string }
  WEEKDAY_ASSUMED_NEXT: { weekday: string }
}

/**
 * The data payload passed *into* `makeIssue()`/a custom `messages[code]`
 * function — `IssueDataMap[C]` plus the `suggestions` every code accepts.
 * @example
 * ```ts
 * import { makeIssue, type IssueInputData } from '@pascal-app/lingo/core'
 * const data: IssueInputData<'UNKNOWN_UNIT'> = { unit: 'meterz', suggestions: ['m'] }
 * makeIssue('UNKNOWN_UNIT', data).suggestions // ['m']
 * ```
 */
export type IssueInputData<C extends IssueCode = IssueCode> = IssueDataMap[C] & {
  suggestions?: string[]
}

/**
 * A structured parse/validation issue. Never thrown for user input — returned.
 * `ok: false` results contain at least one `severity: 'error'` issue; warnings
 * and infos ride along on successful results.
 * @example
 * ```ts
 * import { lingo } from '@pascal-app/lingo'
 * const r = lingo('5 meterz', { kind: 'length' })
 * r.issues[0]
 * // { code: 'TYPO_CORRECTED', severity: 'warning',
 * //   message: 'Read "meterz" as m.', span: { start: 2, end: 8 },
 * //   data: { unit: 'meterz', corrected: 'm' } }
 * ```
 */
export interface LingoIssue<C extends IssueCode = IssueCode> {
  code: C
  /** Code-specific structured payload (JSON-serializable). */
  data?: IssueDataMap[C]
  /** Human-readable copy (en default; overridable via the `messages` option). */
  message: string
  severity: Severity
  /**
   * `{ start, end }` half-open character offsets into the ORIGINAL input string.
   * Every parse-path issue carries one. Absent only on field-level bound issues
   * (`RANGE_MIN`/`RANGE_MAX` from the `/ai` fields), which are raised against
   * option bounds after a successful parse — there is no input text to point at.
   */
  span?: Span
  /** Ready-to-render did-you-mean candidates, most likely first (max 3). */
  suggestions?: string[]
}

/**
 * How to read `.`/`,` in numbers when only one of them is present.
 * `'auto'` (default) guesses from digit grouping; pin it when you know your
 * users' locale.
 * @example
 * ```ts
 * import { parseQuantity } from '@pascal-app/lingo'
 * const a = parseQuantity('1,234 kg', { numberFormat: 'dot-decimal' })
 * a.ok && a.quantity.base // 1234 (comma = grouping)
 * const b = parseQuantity('1.234 kg', { numberFormat: 'comma-decimal' })
 * b.ok && b.quantity.base // 1234 (dot = grouping)
 * ```
 */
export type NumberFormatPolicy = 'auto' | 'dot-decimal' | 'comma-decimal'

/**
 * Per-code overrides for issue message copy — a string template
 * (`{placeholder}`s pull from `issue.data`) or a function for full control.
 * `{didYouMean}` is special: it renders a localized did-you-mean tail from
 * `suggestions` (empty when there are none).
 * `lingo/core` ships copy-free (codes fall back to the code string); the
 * batteries-included entries register `englishMessages` by default.
 * @example
 * ```ts
 * import { lingo, type Messages } from '@pascal-app/lingo'
 * const messages: Messages = {
 *   UNIT_ASSUMED: (data) => `Confirm you meant ${data.unit}.`,
 *   REQUIRED: 'This field is required.',
 * }
 * lingo('72', { kind: 'length', unit: 'cm', messages })
 * ```
 */
export type Messages = Partial<{
  [C in IssueCode]: string | ((data: IssueInputData<C>) => string)
}>

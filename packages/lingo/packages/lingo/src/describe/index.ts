import { Quantity, type QuantityPart, QuantityRange, registryOf } from '../core/quantity'
import type {
  IssueCode,
  IssueDataMap,
  Kind,
  LingoIssue,
  Span,
  UnitDef,
  UnitSystem,
} from '../core/types'
import type {
  DateAlternative,
  DateFail,
  DateGrain,
  DateResult,
  DurationResult,
} from '../date/index'
import type { Alternative, LingoResult } from '../parse/grammar'

export interface UnitDescription {
  /** Canonical unit id, parseable anywhere a unit ref is accepted. */
  id: string
  /** Singular display name. */
  name: string
  /** Irregular plural when it differs from `${name}s`. */
  plural?: string
  /** Short display symbol. */
  symbol: string
  /** Unit system grouping, when the unit declares one. */
  system?: UnitSystem
}

/** Internal flat view a `QuantityResource` is assembled from. */
interface QuantityDescription {
  approximate?: boolean
  base: {
    unit: UnitDescription
    value: number
  }
  formatted: string
  kind: Kind
  parts?: QuantityPart[]
  type: 'quantity'
  unit: UnitDescription
  value: number
}

/** One described range edge or plus/minus center/delta (internal). */
interface RangeBoundDescription {
  base: {
    unit: UnitDescription
    value: number
  }
  exclusive?: boolean
  unit: UnitDescription
  value: number
}

/** Internal flat view a `RangeResource` is assembled from. */
interface QuantityRangeDescription {
  approximate?: boolean
  baseUnit: UnitDescription
  formatted: string
  fuzzy?: { term: string; profile: string }
  kind: Kind
  max?: RangeBoundDescription
  min?: RangeBoundDescription
  plusMinus?: {
    center: RangeBoundDescription
    delta: RangeBoundDescription
  }
  type: 'range'
}

export interface SourceSpanDescription extends Span {
  /** Original input substring covered by this span. */
  text: string
}

export interface IssueDescription<C extends IssueCode = IssueCode> {
  code: C
  data?: IssueDataMap[C]
  message: string
  object: 'lingo.issue'
  severity: LingoIssue<C>['severity']
  source?: { span: SourceSpanDescription }
  suggestions?: string[]
}

export interface ResourceAmount {
  amount: number
  unit: UnitDescription
}

export interface QuantityResource {
  approximate?: boolean
  canonical: ResourceAmount
  formatted: string
  kind: Kind
  object: 'lingo.quantity'
  parts?: ResourceAmount[]
  value: ResourceAmount
}

export interface RangeBoundResource {
  canonical: ResourceAmount
  exclusive?: boolean
  value: ResourceAmount
}

export interface RangeResource {
  approximate?: boolean
  canonicalUnit: UnitDescription
  formatted: string
  fuzzy?: { term: string; profile: string }
  kind: Kind
  max?: RangeBoundResource
  min?: RangeBoundResource
  object: 'lingo.range'
  plusMinus?: {
    center: RangeBoundResource
    delta: RangeBoundResource
  }
}

export interface ConversionResource {
  converted: QuantityResource | RangeResource
  object: 'lingo.conversion'
  source: QuantityResource | RangeResource
  target: { unit: UnitDescription }
}

export interface NumberResource {
  approximate?: boolean
  object: 'lingo.number'
  value: number
}

export interface DateResource {
  calendar?: {
    day?: number
    hour?: number
    minute?: number
    month?: number
    second?: number
    year?: number
  }
  grain?: DateGrain
  known?: string[]
  object: 'lingo.date'
  value: {
    epochMilliseconds: number
    iso: string
  }
}

export interface DurationResource {
  canonical: ResourceAmount
  formatted: string
  kind: 'duration'
  object: 'lingo.duration'
  parts?: ResourceAmount[]
  value: ResourceAmount
}

export type ValueResource = QuantityResource | RangeResource

export interface QuantityAlternativeResource {
  confidence: number
  data: QuantityResource
  object: 'lingo.alternative'
  reason: string
  type: 'quantity'
}

export interface DateAlternativeResource {
  confidence: number
  data: DateResource
  object: 'lingo.alternative'
  reason: string
  type: 'date'
}

export type AlternativeResource = QuantityAlternativeResource | DateAlternativeResource

export type ResultResourceData =
  | QuantityResource
  | RangeResource
  | ConversionResource
  | NumberResource
  | DateResource
  | DurationResource

type DescribableResult = LingoResult | DateResult | DurationResult | DateFail

type SuccessfulDescribableResult = Extract<DescribableResult, { ok: true }>
type ResultResourceType = SuccessfulDescribableResult['type'] | 'failure'

interface ResultResourceBase {
  input: {
    span?: SourceSpanDescription
    text: string
  }
  issues: IssueDescription[]
  object: 'lingo.parse_result'
  resourceSchemaVersion: 1
  type: ResultResourceType
}

export interface SuccessfulResultResource extends ResultResourceBase {
  alternatives?: AlternativeResource[]
  confidence: number
  data: ResultResourceData
  status: 'success'
  type: SuccessfulDescribableResult['type']
}

export interface FailedResultResource extends ResultResourceBase {
  candidate?: SuccessfulResultResource
  status: 'failure'
  type: 'failure'
}

export type ResultResource = SuccessfulResultResource | FailedResultResource

/**
 * Resource-shaped value view for a standalone quantity or range. This returns
 * the same `lingo.quantity` / `lingo.range` primitives that `describeResult()`
 * nests inside parse-result resources, without wrapping the value in a fake
 * parse result. Keep `toJSON()` for compact wire storage.
 * @example
 * ```ts
 * import { quantity } from '@pascal-app/lingo'
 * import { describeResource } from '@pascal-app/lingo/describe'
 * describeResource(quantity(72, 'in')).canonical.unit.id // 'm'
 * ```
 */
export function describeResource(value: Quantity): QuantityResource
export function describeResource(value: QuantityRange): RangeResource
export function describeResource(value: Quantity | QuantityRange): ValueResource {
  if (value instanceof QuantityRange) {
    return rangeResource(value)
  }
  if (value instanceof Quantity) {
    return quantityResource(value)
  }
  // JS callers and LLM tool output bypass the type guard; fail with a clear
  // pointer instead of a cryptic `value.toJSON is not a function`.
  throw new TypeError(
    'describeResource expects a Quantity or QuantityRange. For a parse result from lingo()/parseDate()/parseDuration(), use describeResult() instead.',
  )
}

/**
 * Resource-style parse result view for logs, docs, and tool output. It accepts
 * `lingo()` results plus `parseDate()`/`parseDuration()` results and keeps
 * existing compact JSON shapes untouched while making values, units, issues,
 * and source spans readable in one object.
 * @example
 * ```ts
 * import { lingo } from '@pascal-app/lingo'
 * import { describeResult } from '@pascal-app/lingo/describe'
 * describeResult(lingo('5 meterz', { kind: 'length' })).object // 'lingo.parse_result'
 * ```
 */
export function describeResult(
  result: LingoResult | DateResult | DurationResult | DateFail,
): ResultResource {
  return describeResultResource(result)
}

function describeResultResource(result: DescribableResult): ResultResource {
  const issues = result.issues.map((issue) => issueDescription(issue, result.text))
  const base = {
    object: 'lingo.parse_result' as const,
    resourceSchemaVersion: 1 as const,
    type: result.ok ? result.type : 'failure',
    input: {
      text: result.text,
      span: sourceSpan(result.text, result.ok ? result.span : fullInputSpan(result.text)),
    },
    issues,
  }
  if (!result.ok) {
    const candidate = successfulCandidate(result.candidate)
    return {
      ...base,
      status: 'failure',
      type: 'failure',
      ...(candidate
        ? { candidate: describeResultResource(candidate) as SuccessfulResultResource }
        : {}),
    }
  }
  const alternatives = resultAlternatives(result)
  return {
    ...base,
    status: 'success',
    type: result.type,
    data: resultData(result),
    ...(alternatives ? { alternatives } : {}),
    confidence: result.confidence,
  }
}

function describeQuantity(quantity: Quantity): QuantityDescription {
  const json = quantity.toJSON()
  const reg = registryOf(quantity)
  const out: QuantityDescription = {
    type: 'quantity',
    kind: json.kind,
    value: json.value,
    unit: unitDescription(quantity.unitInfo()),
    base: {
      value: json.base,
      unit: unitDescription(reg.unit(json.kind, json.baseUnit)!),
    },
    formatted: quantity.format(),
  }
  if (json.approximate) {
    out.approximate = true
  }
  if (json.parts) {
    out.parts = json.parts
  }
  return out
}

function quantityResource(quantity: Quantity): QuantityResource {
  const described = describeQuantity(quantity)
  const out: QuantityResource = {
    object: 'lingo.quantity',
    kind: described.kind,
    value: { amount: described.value, unit: described.unit },
    canonical: { amount: described.base.value, unit: described.base.unit },
    formatted: described.formatted,
  }
  if (described.approximate) {
    out.approximate = true
  }
  if (described.parts) {
    out.parts = described.parts.map((part) => quantityPartResource(quantity, part))
  }
  return out
}

function describeRange(range: QuantityRange): QuantityRangeDescription {
  const json = range.toJSON()
  const reg = registryOf(range)
  const baseUnit = unitDescription(reg.unit(json.kind, json.baseUnit)!)
  const out: QuantityRangeDescription = {
    type: 'range',
    kind: json.kind,
    baseUnit,
    formatted: range.format(),
  }
  if (json.min) {
    out.min = rangeBound(json.min, baseUnit, unitDescription(reg.unit(json.kind, json.min.unit)!))
  }
  if (json.max) {
    out.max = rangeBound(json.max, baseUnit, unitDescription(reg.unit(json.kind, json.max.unit)!))
  }
  if (json.plusMinus) {
    out.plusMinus = {
      center: rangeBound(
        json.plusMinus.center,
        baseUnit,
        unitDescription(reg.unit(json.kind, json.plusMinus.center.unit)!),
      ),
      delta: rangeBound(
        json.plusMinus.delta,
        baseUnit,
        unitDescription(reg.unit(json.kind, json.plusMinus.delta.unit)!),
      ),
    }
  }
  if (json.approximate) {
    out.approximate = true
  }
  if (json.fuzzy) {
    out.fuzzy = json.fuzzy
  }
  return out
}

function rangeResource(range: QuantityRange): RangeResource {
  const described = describeRange(range)
  const out: RangeResource = {
    object: 'lingo.range',
    kind: described.kind,
    canonicalUnit: described.baseUnit,
    formatted: described.formatted,
  }
  if (described.min) {
    out.min = rangeBoundResource(described.min)
  }
  if (described.max) {
    out.max = rangeBoundResource(described.max)
  }
  if (described.plusMinus) {
    out.plusMinus = {
      center: rangeBoundResource(described.plusMinus.center),
      delta: rangeBoundResource(described.plusMinus.delta),
    }
  }
  if (described.approximate) {
    out.approximate = true
  }
  if (described.fuzzy) {
    out.fuzzy = described.fuzzy
  }
  return out
}

function quantityPartResource(quantity: Quantity, part: QuantityPart): ResourceAmount {
  const unit = unitDescription(registryOf(quantity).unit(quantity.kind, part.unit)!)
  return { amount: part.value, unit }
}

function rangeBound(
  bound: { value: number; unit: string; base: number; exclusive?: boolean },
  baseUnit: UnitDescription,
  unit: UnitDescription,
): RangeBoundDescription {
  const out: RangeBoundDescription = {
    value: bound.value,
    unit,
    base: { value: bound.base, unit: baseUnit },
  }
  if (bound.exclusive) {
    out.exclusive = true
  }
  return out
}

function rangeBoundResource(bound: RangeBoundDescription): RangeBoundResource {
  const out: RangeBoundResource = {
    value: { amount: bound.value, unit: bound.unit },
    canonical: { amount: bound.base.value, unit: bound.base.unit },
  }
  if (bound.exclusive) {
    out.exclusive = true
  }
  return out
}

function resultData(result: SuccessfulDescribableResult): ResultResourceData {
  if (result.type === 'quantity') {
    return quantityResource(result.quantity)
  }
  if (result.type === 'range') {
    return rangeResource(result.range)
  }
  if (result.type === 'conversion') {
    return {
      object: 'lingo.conversion',
      source:
        result.source instanceof QuantityRange
          ? rangeResource(result.source)
          : quantityResource(result.source),
      target: { unit: describedUnit(result.source, result.targetUnit) },
      converted:
        result.converted instanceof QuantityRange
          ? rangeResource(result.converted)
          : quantityResource(result.converted),
    }
  }
  if (result.type === 'date') {
    return dateResource(result)
  }
  if (result.type === 'duration') {
    return durationResource(result)
  }
  return {
    object: 'lingo.number',
    value: result.value,
    ...(result.approximate ? { approximate: true } : {}),
  }
}

function resultAlternatives(
  result: SuccessfulDescribableResult,
): AlternativeResource[] | undefined {
  if (result.type === 'quantity' && result.alternatives) {
    return result.alternatives.map(quantityAlternativeResource)
  }
  if (result.type === 'date' && result.alternatives) {
    return result.alternatives.map(dateAlternativeResource)
  }
  return
}

function quantityAlternativeResource(alternative: Alternative): QuantityAlternativeResource {
  return {
    object: 'lingo.alternative',
    type: alternative.type,
    reason: alternative.reason,
    confidence: alternative.confidence,
    data: quantityResource(alternative.quantity),
  }
}

function dateAlternativeResource(alternative: DateAlternative): DateAlternativeResource {
  return {
    object: 'lingo.alternative',
    type: alternative.type,
    reason: alternative.reason,
    confidence: alternative.confidence,
    data: dateResource(alternative),
  }
}

function dateResource(result: DateResult | DateAlternative): DateResource {
  const out: DateResource = {
    object: 'lingo.date',
    value: {
      iso: result.date.toISOString(),
      epochMilliseconds: result.date.getTime(),
    },
  }
  if ('grain' in result) {
    out.grain = result.grain
    out.calendar = calendarResource(result)
  }
  if ('known' in result) {
    out.known = result.known
  }
  return out
}

function calendarResource(result: DateResult): NonNullable<DateResource['calendar']> {
  const known = new Set(result.known)
  const out: NonNullable<DateResource['calendar']> = {}
  if (known.has('year')) {
    out.year = result.date.getFullYear()
  }
  if (known.has('month')) {
    out.month = result.date.getMonth() + 1
  }
  if (known.has('day')) {
    out.day = result.date.getDate()
  }
  if (known.has('hour')) {
    out.hour = result.date.getHours()
  }
  if (known.has('minute')) {
    out.minute = result.date.getMinutes()
  }
  if (known.has('second')) {
    out.second = result.date.getSeconds()
  }
  return out
}

function durationResource(result: DurationResult): DurationResource {
  const quantity = quantityResource(result.duration)
  const out: DurationResource = {
    object: 'lingo.duration',
    kind: 'duration',
    value: quantity.value,
    canonical: quantity.canonical,
    formatted: quantity.formatted,
  }
  if (quantity.parts) {
    out.parts = quantity.parts
  }
  return out
}

function successfulCandidate(candidate: unknown): SuccessfulDescribableResult | null {
  if (!candidate || typeof candidate !== 'object') {
    return null
  }
  const value = candidate as Partial<SuccessfulDescribableResult>
  return value.ok === true && isSupportedResultType(value.type)
    ? (value as SuccessfulDescribableResult)
    : null
}

function isSupportedResultType(type: unknown): type is SuccessfulDescribableResult['type'] {
  return (
    type === 'quantity' ||
    type === 'range' ||
    type === 'conversion' ||
    type === 'number' ||
    type === 'date' ||
    type === 'duration'
  )
}

function describedUnit(value: Quantity | QuantityRange, unitId: string): UnitDescription {
  const json = value.toJSON()
  return unitDescription(registryOf(value).unit(json.kind, unitId)!)
}

function issueDescription(issue: LingoIssue, text: string): IssueDescription {
  const out: IssueDescription = {
    object: 'lingo.issue',
    code: issue.code,
    severity: issue.severity,
    message: issue.message,
  }
  if (issue.span) {
    out.source = { span: sourceSpan(text, issue.span) }
  }
  if (issue.suggestions) {
    out.suggestions = issue.suggestions
  }
  if (issue.data) {
    out.data = issue.data
  }
  return out
}

function sourceSpan(text: string, span: Span): SourceSpanDescription {
  return {
    start: span.start,
    end: span.end,
    text: text.slice(span.start, span.end),
  }
}

function fullInputSpan(text: string): Span {
  return { start: 0, end: text.length }
}

function unitDescription(unit: UnitDef): UnitDescription {
  const out: UnitDescription = {
    id: unit.id,
    symbol: unit.symbol,
    name: unit.name,
  }
  if (unit.plural) {
    out.plural = unit.plural
  }
  if (unit.system) {
    out.system = unit.system
  }
  return out
}

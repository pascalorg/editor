import type { LingoIssue, LingoResult, Quantity, QuantityRange, Severity } from '@pascal-app/lingo'
import type { DateFail, DateResult } from '@pascal-app/lingo/date'
import { unitSymbol } from '@/lib/unit-labels'

export type DisplayResult = LingoResult | DateResult | DateFail<DateResult>

type ParsedValue = Quantity | QuantityRange

export function formatParsedValue(value: ParsedValue): string {
  return value.format({ significant: 5 })
}

function dateLabel(result: DateResult) {
  return result.date.toISOString().replace('.000Z', 'Z')
}

export function resultValueLabel(result: DisplayResult | null): string {
  if (!result) {
    return 'Awaiting input'
  }

  if (!result.ok) {
    return result.candidate ? `Rejected: ${resultValueLabel(result.candidate)}` : 'No parse'
  }

  switch (result.type) {
    case 'date':
      return dateLabel(result)
    case 'quantity':
      return result.quantity.format({ significant: 5 })
    case 'range':
      return result.range.format({ significant: 5 })
    case 'conversion':
      return formatParsedValue(result.converted)
    case 'number':
      return String(result.value)
  }
}

export function resultKindLabel(result: DisplayResult | null): string {
  if (!result) {
    return 'idle'
  }

  if (!result.ok) {
    return result.candidate ? `${result.candidate.type} candidate` : 'failed'
  }

  if (result.type === 'quantity') {
    return result.quantity.kind
  }

  if (result.type === 'range') {
    return result.range.kind
  }

  if (result.type === 'conversion') {
    return `${result.source.kind} -> ${unitSymbol(result.source.kind, result.targetUnit)}`
  }

  if (result.type === 'date') {
    return `date:${result.grain}`
  }

  return 'number'
}

export function resultConfidence(result: DisplayResult | null): number {
  return result?.ok ? Math.round(result.confidence * 100) : 0
}

export function resultIssues(result: DisplayResult | null): LingoIssue[] {
  return result?.issues ?? []
}

export function candidateLabel(result: DisplayResult): string | null {
  if (result.ok || !result.candidate) {
    return null
  }

  return resultValueLabel(result.candidate)
}

/**
 * The result's real v3 wire JSON — exactly what `JSON.stringify(result)`
 * emits (flat shape, self-describing `{ start, end, text }` spans). The
 * "Raw JSON" views must never show a hand-built approximation: the wire
 * shape reading for itself IS the product claim.
 */
export function resultToPlain(result: DisplayResult | null): unknown {
  return result ? JSON.parse(JSON.stringify(result)) : null
}

export function issueClass(severity: Severity): string {
  switch (severity) {
    case 'error':
      return 'border-[var(--badge-destructive-border)] bg-[var(--badge-destructive-background)] text-[var(--badge-destructive-foreground)]'
    case 'warning':
      return 'border-[var(--badge-warning-border)] bg-[var(--badge-warning-background)] text-[var(--badge-warning-foreground)]'
    case 'info':
      return 'border-[var(--badge-muted-border)] bg-[var(--badge-muted-background)] text-[var(--badge-muted-foreground)]'
  }
}

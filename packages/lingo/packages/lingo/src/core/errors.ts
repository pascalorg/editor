import type { IssueCode, IssueInputData, LingoIssue, Messages, Severity, Span } from './types'

/**
 * Issue construction with overridable copy (plan 009). Default en messages
 * are short, name the problem, and point at the fix. `{placeholders}` pull
 * from the issue's `data` payload.
 */

const SEVERITY: Partial<Record<IssueCode, Severity>> = {
  TYPO_CORRECTED: 'warning',
  AMBIGUOUS_NUMBER: 'warning',
  AMBIGUOUS_UNIT: 'warning',
  AMBIGUOUS_DATE: 'warning',
  RANGE_REVERSED: 'warning',
  COMPOUND_OVERFLOW: 'warning',
  SLANG_UNIT: 'warning',
  TZ_IGNORED: 'warning',
  AMBIGUOUS_TIMEZONE: 'warning',
  CIVIL_AVERAGE: 'info',
  UNIT_ASSUMED: 'info',
  WEEKDAY_ASSUMED_NEXT: 'info',
}

/**
 * Default copy store. Entries register a message pack (src/messages/en.ts) at
 * module load; `lingo/core` stays copy-free and falls back to the issue
 * code string (BYO copy via the `messages` option). Swappable = i18n-ready.
 */
let defaultMessages: Partial<Record<IssueCode, string>> = {}

/**
 * Register the fallback copy pack used when a result/call site doesn't pass
 * its own `messages` option. `lingo/core` ships without a pack (codes fall
 * back to the code string); the batteries-included entries call this with
 * `englishMessages` at module load.
 * @example
 * ```ts
 * import { setDefaultMessages } from '@pascal-app/lingo/core'
 * setDefaultMessages({ REQUIRED: 'This field is required.' })
 * ```
 */
export function setDefaultMessages(pack: Partial<Record<IssueCode, string>>): void {
  defaultMessages = pack
}

function interpolate(template: string, data: Record<string, unknown>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => {
    if (key === 'didYouMean') {
      const suggestions = data['suggestions']
      return Array.isArray(suggestions) && suggestions.length > 0
        ? ` — did you mean ${suggestions.join(', ')}?`
        : ''
    }
    const v = data[key]
    return v === undefined || v === null ? '' : String(v)
  })
}

/**
 * Build a `LingoIssue` from a code and its structured data, rendering the
 * human `message` from `messages`/the default pack/the code string
 * (in that order).
 * @example
 * ```ts
 * import { makeIssue } from '@pascal-app/lingo/core'
 * makeIssue('UNKNOWN_UNIT', { unit: 'meterz', suggestions: ['m'] }, { start: 2, end: 8 })
 * // { code: 'UNKNOWN_UNIT', severity: 'error', message: 'UNKNOWN_UNIT',
 * //   span: { start: 2, end: 8 }, suggestions: ['m'], data: { unit: 'meterz' } }
 * // (message renders as real copy once englishMessages is registered —
 * // see setDefaultMessages/the `messages` option)
 * ```
 */
export function makeIssue<C extends IssueCode>(
  code: C,
  data: IssueInputData<C> = {} as IssueInputData<C>,
  span?: Span,
  messages?: Messages,
): LingoIssue<C> {
  const custom = messages?.[code]
  const message =
    typeof custom === 'function'
      ? (custom as (data: IssueInputData<C>) => string)(data)
      : interpolate(custom ?? defaultMessages[code] ?? code, data as Record<string, unknown>)
  const issue: LingoIssue<C> = { code, severity: SEVERITY[code] ?? 'error', message }
  if (span) {
    issue.span = span
  }
  const suggestions = data['suggestions']
  if (Array.isArray(suggestions) && suggestions.length > 0) {
    issue.suggestions = suggestions as string[]
  }
  const rest = { ...data }
  delete rest['suggestions']
  if (Object.keys(rest).length > 0) {
    issue.data = rest as LingoIssue<C>['data']
  }
  return issue
}

/**
 * Does any issue in the list have `severity: 'error'`?
 * @example
 * ```ts
 * import { hasError, makeIssue } from '@pascal-app/lingo/core'
 * hasError([makeIssue('TYPO_CORRECTED', { unit: 'meterz', corrected: 'm' })]) // false (a warning)
 * hasError([makeIssue('UNKNOWN_UNIT', { unit: 'meterz' })])                  // true
 * ```
 */
export function hasError(issues: readonly LingoIssue[]): boolean {
  return issues.some((i) => i.severity === 'error')
}

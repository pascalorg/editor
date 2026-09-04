import { makeIssue } from '../core/errors'
import type { IssueCode, IssueInputData, LingoIssue, Severity, Span } from '../core/types'
import type { LanguageProfile } from '../locale/types'
import type { Normalized } from '../parse/normalize'
import { toSourceSpan } from '../parse/normalize'
import type { Token } from '../parse/tokenize'
import type { DateAlternative, DateGrain, DateOptions } from './parse'
import type { DateZone } from './zone'

export interface P {
  escalate: Partial<Record<IssueCode, Severity>>
  forwardDates: boolean
  n: Normalized
  now: Date
  opts: DateOptions
  profile: LanguageProfile
  src: string
  text: string
  tokens: Token[]
  weekStart: number
}

export interface CoreDate {
  alternatives?: DateAlternative[]
  date: Date
  grain: DateGrain
  issues: LingoIssue[]
  known: string[]
  normEnd: number
  normStart: number
  ref?: true
  zone?: DateZone
}

export function core(
  date: Date,
  grain: DateGrain,
  known: string[],
  normStart: number,
  normEnd: number,
  issues: LingoIssue[] = [],
  alternatives?: DateAlternative[],
): CoreDate {
  return { date, grain, known, normStart, normEnd, issues, alternatives }
}

export function needsNow(core: CoreDate): CoreDate {
  core.ref = true
  return core
}

export function issue<C extends IssueCode>(
  p: P,
  code: C,
  data: IssueInputData<C>,
  start: number,
  end: number,
): LingoIssue<C> {
  return makeIssue(code, data, toSourceSpan(p.n, start, end), p.opts.messages)
}

export function confidence(issues: readonly LingoIssue[]): number {
  let score = 1
  for (const it of issues) {
    if (it.code === 'AMBIGUOUS_DATE') {
      score -= 0.2
    } else if (it.code === 'WEEKDAY_ASSUMED_NEXT' || it.code === 'TZ_IGNORED') {
      score -= 0.1
    } else if (it.severity === 'info') {
      score -= 0.05
    }
  }
  return Math.max(0.05, Math.round(score * 100) / 100)
}

export function trimRange(text: string, start: number, end: number): Span {
  while (start < end && /\s/.test(text[start]!)) {
    start++
  }
  while (end > start && /\s/.test(text[end - 1]!)) {
    end--
  }
  return { start, end }
}

export function stripDateFillers(p: P, source: string): string {
  const fillers = p.profile.date?.fillerWords ?? ['the']
  if (fillers.length === 0) {
    return source
  }
  const fillerSet = new Set(fillers)
  return source
    .split(/\s+/)
    .filter((word) => !fillerSet.has(word.toLowerCase()))
    .join(' ')
}

export function knownFor(grain: DateGrain): string[] {
  if (grain === 'year') {
    return ['year']
  }
  if (grain === 'month') {
    return ['year', 'month']
  }
  if (grain === 'week') {
    return ['year', 'month', 'day', 'week']
  }
  if (grain === 'day') {
    return ['year', 'month', 'day']
  }
  if (grain === 'hour') {
    return ['year', 'month', 'day', 'hour']
  }
  if (grain === 'minute') {
    return ['year', 'month', 'day', 'hour', 'minute']
  }
  return ['year', 'month', 'day', 'hour', 'minute', 'second']
}

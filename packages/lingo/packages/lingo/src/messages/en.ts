import type { IssueCode } from '../core/types'

/**
 * English default copy — the first "message pack" (plan 013: copy is data,
 * never engine logic). Batteries-included entries register this via
 * setDefaultMessages(); `lingo/core` ships without it (issue codes fall
 * back to the code string; bring your own copy via the `messages` option).
 * Exported from the main entry as `englishMessages` — useful for `lingo/core`
 * users who want the default English copy, or as a base to override.
 * @example
 * ```ts
 * import { englishMessages } from '@pascal-app/lingo'
 * import { setDefaultMessages } from '@pascal-app/lingo/core'
 * setDefaultMessages({ ...englishMessages, REQUIRED: 'You must fill this in.' })
 * ```
 */
export const en: Record<IssueCode, string> = {
  EMPTY: 'Enter a value.',
  NO_VALUE: 'No number found — try something like {example}.',
  UNKNOWN_UNIT: 'Unknown unit "{unit}"{didYouMean}',
  KIND_MISMATCH: 'That looks like {found}, but this field needs {expected} — try {example}.',
  RANGE_KIND_MISMATCH: 'Both ends of a range must use the same kind of unit ({left} vs {right}).',
  CONVERSION_KIND_MISMATCH: 'Cannot convert {found} to {target} — different kinds of measurement.',
  RATE_REQUIRED: 'Currency conversion from {from} to {to} needs rates — use convertCurrency(…).',
  TRAILING_INPUT: 'Could not understand "{text}" after the value.',
  SINGLE_VALUE_EXPECTED: 'This field needs a single value, not a range.',
  NUMBER_FORMAT: '"{text}" is not a valid number.',
  NONFINITE: 'That number is too large.',
  LOCALE_NOT_LOADED: 'Import @pascal-app/lingo/locales/<locale>; use createLingo({ locales }).',
  RANGE_MIN: 'Must be at least {min}.',
  RANGE_MAX: 'Must be at most {max}.',
  RANGE_OPEN_BOUND_NOT_ALLOWED: 'Include a {missing} value.',
  REQUIRED: 'This field is required.',
  UNSUPPORTED_DATE: 'Could not understand that date — try {example}.',
  NOW_REQUIRED: 'Pass now for relative dates or use an absolute date.',
  TYPO_CORRECTED: 'Read "{unit}" as {corrected}.',
  AMBIGUOUS_NUMBER: '"{text}" could mean {a} or {b} — assuming {a}.',
  AMBIGUOUS_UNIT: '"{unit}" is ambiguous — assuming {assumed}{didYouMean}',
  AMBIGUOUS_DATE: '"{text}" could be {a} or {b} — assuming {a}.',
  RANGE_REVERSED: 'Range was reversed — reading it as {fixed}.',
  COMPOUND_OVERFLOW: '{value} is too large for {unit} here.',
  SLANG_UNIT: 'Read "{alias}" as {unit}.',
  TZ_IGNORED: 'Time zone "{tz}" detected but not applied — pass applyZone to resolve the instant.',
  AMBIGUOUS_TIMEZONE: 'Time zone "{tz}" is ambiguous — use an explicit offset or IANA name.',
  CIVIL_AVERAGE: 'Using the average {unit} length ({detail}).',
  UNIT_ASSUMED: 'Assuming {unit}.',
  WEEKDAY_ASSUMED_NEXT: 'Assuming the upcoming {weekday}.',
  APPROX_NOT_ALLOWED: "Approximate values aren't accepted here — enter an exact value.",
  UNIT_REQUIRED: 'Include a unit — try {example}.',
  CONVERSION_NOT_ALLOWED: "Conversions aren't accepted here — enter the value directly.",
}

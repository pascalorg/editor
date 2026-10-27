import { getLocale } from './registry'

export interface NumberFormatOptions {
  /** Minimum fraction digits. */
  min?: number
  /** Maximum fraction digits. */
  max?: number
  useGrouping?: boolean
  /**
   * Locale used for formatting. React renderers must pass useLocale() so the
   * server and hydration snapshots use the same locale.
   */
  locale?: string
}

export type LengthUnit = 'm' | 'cm' | 'mm' | 'ft' | 'in'

const UNIT_SCALE: Record<LengthUnit, number> = {
  m: 1,
  cm: 100,
  mm: 1000,
  ft: 1 / 0.3048,
  in: 1 / 0.0254,
}

const DEFAULT_UNIT_DIGITS: Record<LengthUnit, number> = {
  m: 2,
  cm: 1,
  mm: 0,
  ft: 2,
  in: 1,
}

function fractionDigits(value: number | undefined, fallback: number): number {
  if (!(typeof value === 'number' && Number.isFinite(value))) return fallback
  return Math.max(0, Math.min(20, Math.round(value)))
}

function decimalSeparator(locale: string): string {
  try {
    return (
      new Intl.NumberFormat([locale, 'en'])
        .formatToParts(1.1)
        .find((part) => part.type === 'decimal')?.value ?? '.'
    )
  } catch {
    return '.'
  }
}

/**
 * The persisted level is zero-based at grade. Japanese and Simplified Chinese
 * label that same storey as floor 1, so floors above it display one higher.
 */
export function levelDisplayNumber(level: number, locale = getLocale()): number {
  if (level <= 0) return level
  try {
    const parsed = new Intl.Locale(locale)
    if (parsed.language === 'ja') return level + 1
    if (
      parsed.language === 'zh' &&
      (parsed.script === 'Hans' || (!parsed.script && parsed.region === 'CN'))
    ) {
      return level + 1
    }
  } catch {
    // Invalid locales use the stored English numbering.
  }
  return level
}

export function formatNumber(value: number, options: NumberFormatOptions = {}): string {
  if (!Number.isFinite(value)) return '--'
  const minimumFractionDigits = fractionDigits(options.min, 0)
  const maximumFractionDigits = Math.max(
    minimumFractionDigits,
    fractionDigits(options.max, Math.max(3, minimumFractionDigits)),
  )

  try {
    return new Intl.NumberFormat([options.locale ?? 'en', 'en'], {
      minimumFractionDigits,
      maximumFractionDigits,
      useGrouping: options.useGrouping ?? false,
    }).format(value)
  } catch {
    return new Intl.NumberFormat('en', {
      minimumFractionDigits,
      maximumFractionDigits,
      useGrouping: options.useGrouping ?? false,
    }).format(value)
  }
}

export function formatLength(
  meters: number,
  unit: LengthUnit,
  options: NumberFormatOptions = {},
): string {
  if (!Number.isFinite(meters)) return '--'
  return `${formatNumber(meters * UNIT_SCALE[unit], {
    ...options,
    max: options.max ?? DEFAULT_UNIT_DIGITS[unit],
  })}\u00a0${unit}`
}

/**
 * Normalize a decimal for parsers that expect `.`. Localized inputs accept
 * their locale separator and `.`; grouping is intentionally not accepted in
 * numeric editor fields because it is ambiguous with decimal commas.
 */
export function normalizeDecimalInput(input: string, locale = getLocale()): string {
  const separator = decimalSeparator(locale)
  if (separator === '.' || input.includes('.')) return input
  return input.replaceAll(separator, '.')
}

export function parseLocalizedNumber(input: string, locale = getLocale()): number | null {
  const normalized = normalizeDecimalInput(input.trim(), locale).replace('−', '-')
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(normalized)) return null
  const value = Number(normalized)
  return Number.isFinite(value) ? value : null
}

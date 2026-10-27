import { formatNumber, type GuideScaleReference } from '@pascal-app/core'

export type ReferenceScaleUnit = 'meters' | 'centimeters' | 'feet' | 'inches'

const MAX_REFERENCE_SCALE_LABEL_LENGTH = 64

/** Mirrors `GuideScaleReference.displayLength`'s `.max()` in core. */
export const MAX_REFERENCE_SCALE_DISPLAY_LENGTH = 1_000_000

export function isValidReferenceScaleDisplayLength(value: number): boolean {
  return Number.isFinite(value) && value > 0 && value <= MAX_REFERENCE_SCALE_DISPLAY_LENGTH
}

const REFERENCE_SCALE_UNIT_LABELS: Record<ReferenceScaleUnit, string> = {
  meters: 'm',
  centimeters: 'cm',
  feet: 'ft',
  inches: 'in',
}

function formatScaleValue(value: number, unit: string, locale: string): string {
  return `${formatNumber(value, { locale, max: 2 })} ${unit}`
}

function getReferenceScaleUnitLabel(unit: unknown): string | null {
  if (typeof unit !== 'string' || !Object.hasOwn(REFERENCE_SCALE_UNIT_LABELS, unit)) return null
  return REFERENCE_SCALE_UNIT_LABELS[unit as ReferenceScaleUnit]
}

function parseLegacyScaleLabel(label: string): { unit: string; value: number } | null {
  // `\s` covers NBSP and narrow NBSP; the whitespace run and digit group are
  // disjoint, so each repetition has exactly one way to match.
  const match = label.trim().match(/^([+−-]?[\d.,]+(?:\s+[\d.,]+)*)\s*(m|cm|ft|in)$/i)
  if (!match) return null

  const compact = match[1]!.replace(/\s/g, '').replace('−', '-')
  const lastDot = compact.lastIndexOf('.')
  const lastComma = compact.lastIndexOf(',')
  const separatorIndex = Math.max(lastDot, lastComma)
  const trailingDigits = separatorIndex === -1 ? 0 : compact.length - separatorIndex - 1
  const decimalSeparator =
    separatorIndex !== -1 && trailingDigits > 0 && trailingDigits <= 2
      ? compact[separatorIndex]
      : null
  const normalized = decimalSeparator
    ? `${compact.slice(0, separatorIndex).replace(/[.,]/g, '')}.${compact
        .slice(separatorIndex + 1)
        .replace(/[.,]/g, '')}`
    : compact.replace(/[.,]/g, '')

  if (!/^[+-]?\d+(?:\.\d+)?$/.test(normalized)) return null
  const value = Number(normalized)
  return Number.isFinite(value) ? { unit: match[2]!.toLowerCase(), value } : null
}

export function createGuideScaleReference(
  reference: Omit<GuideScaleReference, 'displayLength' | 'displayUnit' | 'label'>,
  displayLength: number,
  displayUnit: ReferenceScaleUnit,
): GuideScaleReference {
  const unitLabel = REFERENCE_SCALE_UNIT_LABELS[displayUnit]
  const label = formatScaleValue(displayLength, unitLabel, 'en')
  if (!isValidReferenceScaleDisplayLength(displayLength)) return { ...reference, label }
  return { ...reference, displayLength, displayUnit, label }
}

export function formatReferenceScaleLabel(reference: GuideScaleReference, locale: string): string {
  const unitLabel = getReferenceScaleUnitLabel(reference.displayUnit)
  if (
    typeof reference.displayLength === 'number' &&
    Number.isFinite(reference.displayLength) &&
    unitLabel
  ) {
    return formatScaleValue(reference.displayLength, unitLabel, locale)
  }

  const label: unknown = reference.label
  if (typeof label !== 'string') return typeof label === 'number' ? String(label) : ''
  if (label.length > MAX_REFERENCE_SCALE_LABEL_LENGTH) return label

  const parsed = parseLegacyScaleLabel(label)
  return parsed ? formatScaleValue(parsed.value, parsed.unit, locale) : label
}

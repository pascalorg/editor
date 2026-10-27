import { formatNumber, type GuideScaleReference } from '@pascal-app/core'

export type ReferenceScaleUnit = 'meters' | 'centimeters' | 'feet' | 'inches'

const REFERENCE_SCALE_UNIT_LABELS: Record<ReferenceScaleUnit, string> = {
  meters: 'm',
  centimeters: 'cm',
  feet: 'ft',
  inches: 'in',
}

export function createGuideScaleReference(
  reference: Omit<GuideScaleReference, 'displayLength' | 'displayUnit' | 'label'>,
  displayLength: number,
  displayUnit: ReferenceScaleUnit,
): GuideScaleReference {
  return {
    ...reference,
    displayLength,
    displayUnit,
  }
}

export function formatReferenceScaleLabel(reference: GuideScaleReference, locale: string): string {
  if (reference.displayLength !== undefined && reference.displayUnit !== undefined) {
    return `${formatNumber(reference.displayLength, { locale, max: 2 })} ${
      REFERENCE_SCALE_UNIT_LABELS[reference.displayUnit]
    }`
  }

  return reference.label ?? `${formatNumber(reference.realLengthMeters, { locale, max: 2 })} m`
}

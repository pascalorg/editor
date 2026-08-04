import type { DimensionTerminator, DimensionTextPosition } from '@pascal-app/core'
import type {
  ConstructionImperialPrecision,
  ConstructionMetricNotation,
} from './construction-length'

export type ConstructionDimensionDrawingStandard = {
  datumPolicy: 'centerline' | 'wall-face' | 'structural-face' | 'finish-face'
  intersectionReferencePolicy: 'single' | 'both-faces'
  terminator: DimensionTerminator
  textPosition: DimensionTextPosition
  imperialPrecision: ConstructionImperialPrecision
  metricNotation: ConstructionMetricNotation
  openingChainOffset: number
  wallSpanOffset: number
  firstOpeningWidthOffset: number
  firstGeneralTierOffset: number
  tierSpacing: number
  extensionStartGap: number
  extensionOvershoot: number
}

export const DEFAULT_CONSTRUCTION_DIMENSION_STANDARD = {
  datumPolicy: 'wall-face',
  intersectionReferencePolicy: 'single',
  terminator: 'architectural-tick',
  textPosition: 'above',
  imperialPrecision: '1/16',
  metricNotation: 'meters',
  openingChainOffset: 0.55,
  wallSpanOffset: 1.05,
  firstOpeningWidthOffset: 0.62,
  firstGeneralTierOffset: 0.55,
  tierSpacing: 0.62,
  extensionStartGap: 0.075,
  extensionOvershoot: 0.12,
} satisfies ConstructionDimensionDrawingStandard

export function constructionDimensionStandard(
  overrides: Partial<ConstructionDimensionDrawingStandard> = {},
): ConstructionDimensionDrawingStandard {
  return { ...DEFAULT_CONSTRUCTION_DIMENSION_STANDARD, ...overrides }
}

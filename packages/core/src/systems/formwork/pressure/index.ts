import { aciMaxRiseRateMH, aciPressure } from './aci-347'
import { bsShortcutPressure, ciriaPressure } from './ciria-108'
import { dinMaxRiseRateMH, dinPressure } from './din-18218'
import type { ConcreteMix, Placement, PressureEnvelope, PressureStandardId } from './types'

/**
 * Code-selectable dispatch. The standard is a project decision — it follows the
 * contract and the engineer of record, not the software — so it is an input rather
 * than something chosen here, and DIN is the default only because every panel
 * system in the catalog publishes its permissible pressure against DIN 18218 and
 * comparing a rating to a differently-derived pressure is the one thing this module
 * exists to prevent.
 */

export const DEFAULT_PRESSURE_STANDARD_ID: PressureStandardId = 'DIN_18218'

export function pressureEnvelope(
  standard: PressureStandardId,
  mix: ConcreteMix,
  placement: Placement,
): PressureEnvelope {
  switch (standard) {
    case 'ACI_347':
      return aciPressure(mix, placement)
    case 'CIRIA_108':
      return ciriaPressure(mix, placement)
    case 'BS_5975_SHORTCUT':
      return bsShortcutPressure(mix, placement)
    default:
      return dinPressure(mix, placement)
  }
}

/**
 * The fastest this pour may rise if the form is not to be overloaded, m/h. Only the
 * rate-based codes answer: the BS shortcut has no rate term, and CIRIA's `√R` inside
 * a `√(H − C1√R)` does not invert in closed form, so those return undefined rather
 * than a figure that looks solved.
 */
export function maxRiseRateMH(
  standard: PressureStandardId,
  mix: ConcreteMix,
  placement: Placement,
  permissibleKnM2: number,
): number | undefined {
  switch (standard) {
    case 'ACI_347':
      return aciMaxRiseRateMH(mix, placement, permissibleKnM2)
    case 'DIN_18218':
      return dinMaxRiseRateMH(mix, placement, permissibleKnM2)
    default:
      return undefined
  }
}

export {
  aciMaxRiseRateMH,
  aciPressure,
  chemistryCoefficient,
  hydrostaticKnM2,
  unitWeightCoefficient,
} from './aci-347'
export { bsShortcutPressure, ciriaC2, ciriaK, ciriaPressure } from './ciria-108'
export {
  DIN_DEFAULT_REFERENCE_TEMPERATURE_C,
  DIN_MAX_POUR_HEIGHT_M,
  DIN_MAX_RISE_RATE_MH,
  DIN_PRESSURE_CEILING_KN_M2,
  DIN_REFERENCE_SETTING_H,
  dinCharacteristicKnM2,
  dinMaxRiseRateMH,
  dinPressure,
} from './din-18218'
export {
  RISE_RATE_REFUSAL_LABELS,
  type RiseRateLimit,
  type RiseRateRefusal,
  riseRateLimit,
} from './permitted-rate'
export {
  ACI_COLUMN_PLAN_LIMIT_M,
  ACI_SLUMP_LIMIT_MM,
  ACI_VIBRATION_DEPTH_LIMIT_M,
  type CementSpec,
  type ConcreteMix,
  type ConsistencyClass,
  cementBlend,
  consistencyClassOf,
  DEFAULT_DENSITY_KG_M3,
  DEFAULT_UNIT_WEIGHT_KN_M3,
  delaysSetting,
  densityKgM3,
  equivalentHeadM,
  type Placement,
  PRESSURE_STANDARD_IDS,
  PRESSURE_STANDARD_LABELS,
  type PressureEnvelope,
  type PressureStandardId,
  type PressureWarning,
  type PressureWarningKind,
  PUMP_SURGE_FACTOR,
  pressureAtDepth,
  pressureAtElevationMm,
  unitWeightKnM3,
  verticalElementKind,
} from './types'

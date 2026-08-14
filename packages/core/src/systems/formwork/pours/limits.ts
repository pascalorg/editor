import type { FormworkSettings } from '../settings'
import type { PourLimits } from './types'

/**
 * The part of the resolved project settings the pour split reads.
 *
 * The one live gateway between `FormworkSettings` and `PourLimits`. Nothing else may
 * read `settings.pours`, for the same reason nothing else may re-resolve the settings
 * node: two derivations of the same project data would disagree the first time either
 * gains a case, and a split that snaps against one copy while the validator checks
 * another is the divergence this model was built to prevent.
 *
 * `undefined` on the settings resolves to no limits, which is the split the solver
 * chooses for itself and the state scenario 3 of the permitted-joints contract
 * describes — every boundary labelled solver-chosen rather than as a project decision.
 */
export function pourLimitsFromSettings(settings: FormworkSettings): PourLimits {
  const pours = settings.pours
  if (!pours) return {}
  return {
    ...(pours.permittedJointElevations === undefined
      ? {}
      : { permittedJointElevations: pours.permittedJointElevations }),
    ...(pours.jointSnapTolerance === undefined
      ? {}
      : { jointSnapTolerance: pours.jointSnapTolerance }),
  }
}

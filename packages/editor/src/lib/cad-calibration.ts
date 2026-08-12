import type { CadUnderlayCalibration } from '@pascal-app/core'

/**
 * Rescaling an underlay from a measurement the user took on it.
 *
 * The picking half of calibration is already solved: the measurement tool
 * snaps to underlay geometry, so the user measures a known dimension the
 * normal way and only has to say what it should have been. That keeps this
 * pure arithmetic instead of a second point-picking interaction, and it means
 * calibration inherits every snap improvement the drafting tools get.
 */
export type CalibrationInput = {
  /** Metres per drawing unit currently in force. */
  currentScale: number
  /** What the measurement tool reported, in metres. */
  measuredMeters: number
  /** What that dimension really is, in metres. */
  actualMeters: number
  label?: string
}

export type CalibrationResult = {
  scale: number
  calibration: CadUnderlayCalibration
}

/**
 * Sanity bounds on a single correction. A ratio outside this range is far more
 * likely to be a mistyped figure or a measurement of the wrong thing than a
 * real unit error — the plausible ones (mm↔m is 1000×, inches↔metres 39×) all
 * sit inside it.
 */
const MIN_RATIO = 1 / 10_000
const MAX_RATIO = 10_000

export type CalibrationProblem = 'not-positive' | 'implausible' | 'no-change'

export function validateCalibration({
  measuredMeters,
  actualMeters,
}: Pick<CalibrationInput, 'measuredMeters' | 'actualMeters'>): CalibrationProblem | null {
  if (
    !(Number.isFinite(measuredMeters) && Number.isFinite(actualMeters)) ||
    measuredMeters <= 0 ||
    actualMeters <= 0
  ) {
    return 'not-positive'
  }

  const ratio = actualMeters / measuredMeters
  if (ratio < MIN_RATIO || ratio > MAX_RATIO) return 'implausible'
  // Below a part in ten thousand the correction is noise from the user reading
  // a rounded display back at us.
  if (Math.abs(ratio - 1) < 1e-4) return 'no-change'
  return null
}

export function calibrationProblemMessage(problem: CalibrationProblem): string {
  switch (problem) {
    case 'not-positive':
      return 'Both lengths must be greater than zero.'
    case 'implausible':
      return 'That would rescale the drawing by more than 10,000× — check the figures.'
    case 'no-change':
      return 'Those lengths already agree; nothing to correct.'
  }
}

export function computeCalibration(input: CalibrationInput): CalibrationResult | null {
  if (validateCalibration(input)) return null

  const { currentScale, measuredMeters, actualMeters, label } = input
  return {
    scale: currentScale * (actualMeters / measuredMeters),
    calibration: {
      measuredMeters,
      actualMeters,
      previousScale: currentScale,
      label: label ?? '',
    },
  }
}

/** Undo a calibration exactly, returning the scale that was in force before it. */
export function revertCalibration(calibration: CadUnderlayCalibration): number {
  return calibration.previousScale
}

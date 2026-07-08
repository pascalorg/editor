'use client'

import { useViewer } from '@pascal-app/viewer'
import { useCallback } from 'react'
import { getLinearUnitLabel, linearUnitToMeters, metersToLinearUnit } from './measurements'

/**
 * Shared display/storage conversion for numeric property controls so that
 * every length input honors the metric/imperial toggle identically.
 *
 * Values are always STORED in the field's own unit (meters for `unit === 'm'`).
 * When the viewer preference is imperial AND the field is a meter length, the
 * value is DISPLAYED (and edited) in feet; otherwise the conversions are the
 * identity, so metric fields and non-length units (`'°'`, `'%'`, `'in'`, `''`,
 * …) behave exactly as before.
 *
 * Used by both `SliderControl` and `MetricControl` — keep the two in sync via
 * this single source of truth.
 */
export function useLinearDisplay(unit: string, precision: number) {
  const viewerUnit = useViewer((state) => state.unit)
  const isImperial = viewerUnit === 'imperial' && unit === 'm'
  const displayUnit = isImperial ? getLinearUnitLabel('imperial') : unit

  const toDisplay = useCallback(
    (stored: number) => (isImperial ? metersToLinearUnit(stored, 'imperial') : stored),
    [isImperial],
  )
  const toStored = useCallback(
    (display: number) => (isImperial ? linearUnitToMeters(display, 'imperial') : display),
    [isImperial],
  )
  // Round a stored value so it lands on a clean number of DISPLAY-unit digits.
  const roundStored = useCallback(
    (stored: number) => toStored(Number.parseFloat(toDisplay(stored).toFixed(precision))),
    [toDisplay, toStored, precision],
  )

  return { isImperial, displayUnit, toDisplay, toStored, roundStored }
}

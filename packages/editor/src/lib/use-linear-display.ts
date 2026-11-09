'use client'

import { useViewer } from '@pascal-app/viewer'
import { useMemo } from 'react'
import { getLinearDisplay } from './linear-display'

/** Shared display/input conversion; values and bounds stay in the stored unit. */
export function useLinearDisplay(unit: string, precision: number, step = 1) {
  const viewerUnit = useViewer((state) => state.unit)
  const metricNotation = useViewer((state) => state.metricNotation)

  return useMemo(
    () => getLinearDisplay(unit, viewerUnit, metricNotation, precision, step),
    [unit, viewerUnit, metricNotation, precision, step],
  )
}

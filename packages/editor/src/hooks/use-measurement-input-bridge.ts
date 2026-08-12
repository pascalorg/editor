'use client'

import { useEffect } from 'react'
import { createMeasurementInputBridge } from '../lib/measurement-input-bridge'

/**
 * Mounts the typed-dimension ↔ pointer-event bridge once, next to
 * `useKeyboard`. All behaviour lives in `createMeasurementInputBridge`.
 */
export function useMeasurementInputBridge() {
  useEffect(() => createMeasurementInputBridge(), [])
}

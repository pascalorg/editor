'use client'

import { ElevatorOpeningSystem, ElevatorRuntimeSystem } from '@pascal-app/core'
import { ElevatorInteractionSystem } from '@pascal-app/viewer'

/**
 * Composite system for elevator — bundles three per-frame systems:
 * `ElevatorRuntimeSystem` (cab travel + door state machine),
 * `ElevatorInteractionSystem` (call buttons / cab UI), and
 * `ElevatorOpeningSystem` (wall + slab cutout cascade).
 */
export default function ElevatorSystem() {
  return (
    <>
      <ElevatorRuntimeSystem />
      <ElevatorInteractionSystem />
      <ElevatorOpeningSystem />
    </>
  )
}

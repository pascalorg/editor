'use client'

import { ElevatorOpeningSystem, stepElevatorRuntimes } from '@pascal-app/core'
import { ElevatorInteractionSystem } from '@pascal-app/viewer'
import { useFrame } from '@react-three/fiber'

/** Cab travel + door state machine, stepped once per frame. Lives here rather
 * than in core so the core barrel stays free of runtime R3F imports. */
function ElevatorRuntimeSystem() {
  useFrame(({ clock }, delta) => {
    stepElevatorRuntimes(clock.getElapsedTime() * 1000, delta)
  }, 2)

  return null
}

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

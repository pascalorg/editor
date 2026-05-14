'use client'

import { nodeRegistry } from '@pascal-app/core'
import type { ReactNode } from 'react'

/**
 * Wraps a legacy per-kind system component so it short-circuits the moment a
 * NodeDefinition for the same kind appears in the registry. Lets us migrate
 * one kind at a time without editing each legacy system file individually.
 *
 * Multiple legacy systems can belong to the same kind (e.g. door has both
 * `<DoorSystem>` and `<DoorAnimationSystem>`) — wrap them together so they
 * yield as a unit when the kind registers.
 *
 * Removed in Phase 6 alongside the legacy systems themselves.
 */
export function LegacySystem({ kind, children }: { kind: string; children: ReactNode }) {
  if (nodeRegistry.has(kind)) return null
  return <>{children}</>
}

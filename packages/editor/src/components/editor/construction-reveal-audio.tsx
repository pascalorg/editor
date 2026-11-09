'use client'

import type { RevealPhase } from '@pascal-app/core'
import { type ConstructionRevealLevel, subscribeRevealEvents } from '@pascal-app/viewer'
import { useEffect, useRef } from 'react'
import { triggerSFX } from '../../lib/sfx-bus'

const REVEAL_PHASE_CUES = {
  foundation: 'sfx:structure-build',
  structure: 'sfx:structure-build',
  circulation: 'sfx:structure-build',
  openings: 'sfx:structure-build',
  roof: 'sfx:structure-build',
  furnishing: 'sfx:item-place',
} as const satisfies Record<RevealPhase, 'sfx:structure-build' | 'sfx:item-place'>

/** Mount once alongside ConstructionReveal; its driver owns the commit policy. */
export function ConstructionRevealAudio({
  enabled,
  level,
}: {
  enabled: boolean
  level: ConstructionRevealLevel
}) {
  // Prop changes and Strict Effects must not reset the shared phase/level gate.
  const lastPlayedMs = useRef(Number.NEGATIVE_INFINITY)

  useEffect(() => {
    if (!enabled || (level !== 'full' && level !== 'framing')) return
    return subscribeRevealEvents((event) => {
      if (event.type !== 'land' || event.instant) return
      const nowMs = performance.now()
      if (nowMs - lastPlayedMs.current < 250) return
      lastPlayedMs.current = nowMs
      triggerSFX(REVEAL_PHASE_CUES[event.phase])
    })
  }, [enabled, level])

  return null
}

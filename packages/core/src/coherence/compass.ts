import { COHERENCE_TOLERANCES } from './tolerances'
import type { CoherenceViewSide } from './types'

const COMPASS: CoherenceViewSide[] = [
  'north',
  'north-east',
  'east',
  'south-east',
  'south',
  'south-west',
  'west',
  'north-west',
]

/** The side of `from` that `to` is on, as view_scene's compass names it: north is the plan's top. */
export function sideOf(from: [number, number], to: [number, number]): CoherenceViewSide {
  const dx = to[0] - from[0]
  const dz = to[1] - from[1]
  if (Math.hypot(dx, dz) < COHERENCE_TOLERANCES.contact) return 'south-west'
  const turns = Math.round(Math.atan2(dx, -dz) / (Math.PI / 4))
  return COMPASS[((turns % 8) + 8) % 8]!
}

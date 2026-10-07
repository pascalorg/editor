import { CROSSING_MESSAGE } from './floor-region-geometry'

// Short labels for what core refuses a mezzanine — drawing, moving, turning,
// copying, pushing an edge or adding its stair all read the same words.

export const MEZZANINE_OUTSIDE_MESSAGE = 'Outside the room'
export const MEZZANINE_TOO_SMALL_MESSAGE = 'At least 1 m²'
export const MEZZANINE_OVERLAP_MESSAGE = 'Overlaps a mezzanine'
export const MEZZANINE_ELEVATION_MESSAGE = 'Too high or too low'
export const MEZZANINE_FAILED_MESSAGE = "Can't add a mezzanine here"
export const MEZZANINE_NO_STAIR_MESSAGE = 'No room for stairs'

const CONFLICT_MESSAGES: Record<string, string> = {
  'outside-host': MEZZANINE_OUTSIDE_MESSAGE,
  'overlaps-mezzanine': MEZZANINE_OVERLAP_MESSAGE,
  'mezzanine-overlap': MEZZANINE_OVERLAP_MESSAGE,
  'too-small': MEZZANINE_TOO_SMALL_MESSAGE,
  'self-intersecting': CROSSING_MESSAGE,
  'mezzanine-elevation': MEZZANINE_ELEVATION_MESSAGE,
  'no-room-for-stair': MEZZANINE_NO_STAIR_MESSAGE,
}

/** The label for a core mezzanine conflict code, or null when it is not one of them. */
export function mezzanineConflictMessage(code: string | undefined): string | null {
  return (code && CONFLICT_MESSAGES[code]) || null
}

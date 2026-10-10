import type { PointKind, PointTarget } from './types'

type SuggestionState = {
  /** A room with nothing in it. */
  empty?: boolean
  /** A window already stands where the wall was clicked. */
  hasWindowAtStation?: boolean
}

const CHIPS: Record<Exclude<PointKind, 'room' | 'wall'>, [string, string, string]> = {
  window: ['Make it wider', 'Add a matching window', 'Change the frame colour'],
  door: ['Flip the swing', 'Make it a sliding door', 'Widen it to 90 cm'],
  item: ['Swap for something similar', 'Put it against the wall', 'Remove it'],
  roof: ['Change the pitch', 'Make it a hip roof', 'Change the roofing'],
  stair: ['Turn it 90°', 'Add a handrail', 'Make it wider'],
  several: ['Make these match', 'Line them up', 'Space them evenly'],
  area: ['What’s wrong here?', 'Make this match the reference', 'Tidy this up'],
  other: ['Tell me about this', 'Change its finish', 'Remove it'],
}

/**
 * Three chips chosen locally from the kind and the element's state, with no model call, so they
 * are there on the first frame and teach what Pascal can do here (spec 2.4).
 */
export function suggestionsFor(kind: PointKind, state: SuggestionState = {}): string[] {
  if (kind === 'room')
    return [
      state.empty ? 'Furnish this room' : 'Rearrange the furniture',
      'Make it 1 m longer',
      'Change the floor finish',
    ]
  if (kind === 'wall')
    return [
      state.hasWindowAtStation ? 'Move the window along the wall' : 'Add a window here',
      'Change the finish on this side',
      'Move it 50 cm',
    ]
  return [...CHIPS[kind]]
}

const THIS: Partial<Record<PointKind, string>> = {
  wall: 'this wall',
  window: 'this window',
  door: 'this door',
  item: 'this item',
  roof: 'this roof',
  stair: 'this stair',
}

/** "Ask about Kitchen…", "Ask about this window…", "Ask about these…", "Ask about this area…". */
export function placeholderFor(targets: readonly PointTarget[]): string {
  if (targets.length === 0) return 'Ask about this area…'
  if (targets.length > 1) return 'Ask about these…'
  const [only] = targets as [PointTarget]
  if (only.kind === 'room') return `Ask about ${only.name}…`
  if (only.kind === 'area') return 'Ask about this area…'
  return `Ask about ${THIS[only.kind] ?? 'this'}…`
}

/** What the chips are chosen by, from a node's type. A region is an area whatever it holds. */
export function kindOf(nodeType: string, isRegion = false): PointKind {
  if (isRegion) return 'area'
  switch (nodeType) {
    case 'zone':
      return 'room'
    case 'wall':
      return 'wall'
    case 'window':
      return 'window'
    case 'door':
      return 'door'
    case 'item':
    case 'procedural-item':
    case 'imported-mesh':
    case 'column':
      return 'item'
    case 'roof':
    case 'roof-segment':
      return 'roof'
    case 'stair':
    case 'stair-segment':
      return 'stair'
    default:
      return 'other'
  }
}

export function kindForTargets(targets: readonly PointTarget[], isRegion = false): PointKind {
  if (isRegion || targets.length === 0) return 'area'
  if (targets.length > 1) return 'several'
  return (targets[0] as PointTarget).kind
}

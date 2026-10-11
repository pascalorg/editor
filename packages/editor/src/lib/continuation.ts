export type ContinuationContext = 'wall' | 'fence' | 'point' | 'cabinet' | 'canopy'
export type ContinuationMode = string

export const CONTINUATION_PROFILES: Record<
  ContinuationContext,
  {
    options: ContinuationMode[]
    default: ContinuationMode
    labels: Record<string, string>
    icons: Record<string, string>
    /**
     * Picked once from the Build panel before drawing (`wall-draw-variant.ts`),
     * never cycled by C or a HUD chip mid-draw.
     */
    chosenInPanel?: boolean
  }
> = {
  // The wall tool's drawing mode: a chain that closes into a room ('room', the
  // Build panel's Polygon), one wall per two clicks ('single', Walls), or a
  // two-corner box of four walls ('rectangle', Rectangle).
  wall: {
    options: ['room', 'single', 'rectangle'],
    default: 'room',
    labels: { room: 'Polygon room', single: 'Walls', rectangle: 'Rectangle room' },
    icons: { room: 'lucide:pentagon', single: 'lucide:minus', rectangle: 'lucide:square' },
    chosenInPanel: true,
  },
  fence: {
    options: ['single', 'continuous', 'curved', 'freehand'],
    default: 'continuous',
    labels: {
      continuous: 'Continuous',
      single: 'Single fence',
      curved: 'Curved fence',
      freehand: 'Freehand fence',
    },
    icons: {
      continuous: 'lucide:waypoints',
      single: 'lucide:minus',
      curved: 'lucide:spline',
      freehand: 'lucide:scribble',
    },
  },
  point: {
    options: ['once', 'repeat'],
    default: 'once',
    labels: { once: 'Place once', repeat: 'Place multiple' },
    icons: { once: 'lucide:target', repeat: 'lucide:copy-plus' },
  },
  cabinet: {
    options: ['single', 'continuous'],
    default: 'single',
    labels: { single: 'Single cabinet', continuous: 'Continuous run' },
    icons: { single: 'lucide:minus', continuous: 'lucide:waypoints' },
  },
  canopy: {
    options: ['single', 'continuous'],
    default: 'single',
    labels: { single: 'Single canopy', continuous: 'Continuous canopy' },
    icons: { single: 'lucide:minus', continuous: 'lucide:waypoints' },
  },
}

const POINT_KINDS = new Set(['item', 'door', 'window', 'shelf', 'column'])

export function nextContinuation(
  context: ContinuationContext,
  current: ContinuationMode,
): ContinuationMode {
  const profile = CONTINUATION_PROFILES[context]
  const index = profile.options.indexOf(current)
  if (index === -1) return profile.default
  return profile.options[(index + 1) % profile.options.length] ?? profile.default
}

/**
 * The context C and the HUD chip may cycle — null when there is none, or when
 * its mode is chosen in the Build panel instead.
 */
export function keyCyclableContinuationContext(
  context: ContinuationContext | null,
): ContinuationContext | null {
  return context && !CONTINUATION_PROFILES[context].chosenInPanel ? context : null
}

export function continuationContextOf(kind: string): ContinuationContext | null {
  if (kind === 'wall') return 'wall'
  if (kind === 'fence') return 'fence'
  if (kind === 'cabinet') return 'cabinet'
  if (kind === 'lean-to-extension') return 'canopy'
  return POINT_KINDS.has(kind) ? 'point' : null
}

export type ContinuationContext = 'wall' | 'fence' | 'point'
export type ContinuationMode = string

export const CONTINUATION_PROFILES: Record<
  ContinuationContext,
  {
    options: ContinuationMode[]
    default: ContinuationMode
    labels: Record<string, string>
    icons: Record<string, string>
  }
> = {
  wall: {
    options: ['room', 'single'],
    default: 'room',
    labels: { room: 'Room (auto-close)', single: 'Single wall' },
    icons: { room: 'lucide:square', single: 'lucide:minus' },
  },
  fence: {
    options: ['single', 'continuous', 'curved'],
    default: 'continuous',
    labels: {
      continuous: 'Continuous',
      single: 'Single fence',
      curved: 'Curved fence',
    },
    icons: {
      continuous: 'lucide:waypoints',
      single: 'lucide:minus',
      curved: 'lucide:spline',
    },
  },
  point: {
    options: ['once', 'repeat'],
    default: 'once',
    labels: { once: 'Place once', repeat: 'Place multiple' },
    icons: { once: 'lucide:target', repeat: 'lucide:copy-plus' },
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

export function continuationContextOf(kind: string): ContinuationContext | null {
  if (kind === 'wall') return 'wall'
  if (kind === 'fence') return 'fence'
  return POINT_KINDS.has(kind) ? 'point' : null
}

export type ContinuationContext = 'wall' | 'fence' | 'point' | 'cabinet' | 'canopy'
export type ContinuationMode = string

export const CONTINUATION_PROFILES: Record<
  ContinuationContext,
  {
    options: ContinuationMode[]
    default: ContinuationMode
    // i18n keys — resolved by `useTranslations()` in the helper panel. Keeping
    // the data i18n-key-based (rather than pre-localised strings) lets the
    // active locale switch without re-rendering the parent.
    labels: Record<string, string>
    icons: Record<string, string>
  }
> = {
  wall: {
    options: ['room', 'single'],
    default: 'room',
    labels: { room: 'continuation.wall.room', single: 'continuation.wall.single' },
    icons: { room: 'lucide:square', single: 'lucide:minus' },
  },
  fence: {
    options: ['single', 'continuous', 'curved'],
    default: 'continuous',
    labels: {
      continuous: 'continuation.fence.continuous',
      single: 'continuation.fence.single',
      curved: 'continuation.fence.curved',
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
    labels: { once: 'continuation.point.once', repeat: 'continuation.point.repeat' },
    icons: { once: 'lucide:target', repeat: 'lucide:copy-plus' },
  },
  cabinet: {
    options: ['single', 'continuous'],
    default: 'single',
    labels: { single: 'continuation.cabinet.single', continuous: 'continuation.cabinet.continuous' },
    icons: { single: 'lucide:minus', continuous: 'lucide:waypoints' },
  },
  canopy: {
    options: ['single', 'continuous'],
    default: 'single',
    labels: { single: 'continuation.canopy.single', continuous: 'continuation.canopy.continuous' },
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

export function continuationContextOf(kind: string): ContinuationContext | null {
  if (kind === 'wall') return 'wall'
  if (kind === 'fence') return 'fence'
  if (kind === 'cabinet') return 'cabinet'
  if (kind === 'lean-to-extension') return 'canopy'
  return POINT_KINDS.has(kind) ? 'point' : null
}
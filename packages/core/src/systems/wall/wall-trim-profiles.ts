import type { WallTrimKind, WallTrimProfile } from '../../schema/nodes/wall'

/**
 * How a wall trim stands out across its height: `proudAt(t)` is the share of the trim's `proud`
 * at height fraction `t` (0 at its bottom edge, 1 at its top), sampled `samples` times. Pure data
 * for the wall's skirting, crown and chair rail and for the mouldings of an opening's surround.
 */
export type TrimProfileDefinition = {
  samples: number
  proudAt: (t: number) => number
}

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value))
}

function eased(value: number) {
  const t = clamp01(value)
  return t * t * (3 - 2 * t)
}

export const TRIM_PROFILES: Record<
  WallTrimKind,
  Partial<Record<WallTrimProfile, TrimProfileDefinition>>
> = {
  skirting: {
    flat: {
      samples: 8,
      proudAt: (t) => (t < 0.72 ? 0.62 : 0.9),
    },
    bevel: {
      samples: 10,
      proudAt: (t) => 0.48 + 0.42 * eased(t),
    },
    triangle: {
      samples: 10,
      proudAt: (t) => 0.32 + 0.68 * (1 - t),
    },
    cove: {
      samples: 12,
      proudAt: (t) => 0.45 + 0.42 * Math.sin(t * Math.PI * 0.5),
    },
    bullnose: {
      samples: 12,
      proudAt: (t) => 0.35 + 0.65 * Math.sin(Math.PI * t),
    },
    'base-modern': {
      samples: 10,
      proudAt: (t) => {
        if (t < 0.16) return 0.85
        if (t < 0.72) return 0.58
        if (t < 0.9) return 1
        return 0.62
      },
    },
    'base-colonial': {
      samples: 14,
      proudAt: (t) => {
        if (t < 0.16) return 0.82
        if (t < 0.55) return 0.52
        const capT = (t - 0.55) / 0.45
        return 0.58 + 0.4 * Math.sin(capT * Math.PI)
      },
    },
    'base-shoe': {
      samples: 14,
      proudAt: (t) => {
        const quarterRound = Math.sqrt(Math.max(0, 1 - t * t))
        return 0.28 + 0.72 * quarterRound
      },
    },
    'base-ogee': {
      samples: 16,
      proudAt: (t) => {
        const ogee = 0.5 - 0.5 * Math.cos(Math.PI * t)
        const bead = 0.16 * Math.sin(2 * Math.PI * t)
        return clamp01(0.42 + 0.5 * ogee + bead)
      },
    },
  },
  crown: {
    flat: {
      samples: 8,
      proudAt: (t) => (t < 0.2 ? 0.52 : t < 0.82 ? 0.78 : 1),
    },
    bevel: {
      samples: 10,
      proudAt: (t) => 0.45 + 0.55 * eased(t),
    },
    triangle: {
      samples: 10,
      proudAt: (t) => 0.35 + 0.65 * t,
    },
    cove: {
      samples: 14,
      proudAt: (t) => 0.46 + 0.45 * Math.sin(t * Math.PI * 0.5),
    },
    bullnose: {
      samples: 14,
      proudAt: (t) => 0.38 + 0.62 * Math.sin(Math.PI * t * 0.5),
    },
    'crown-cove': {
      samples: 16,
      proudAt: (t) => {
        if (t < 0.12) return 0.48
        if (t > 0.9) return 1
        return 0.46 + 0.48 * Math.sin(((t - 0.12) / 0.78) * Math.PI * 0.5)
      },
    },
    'crown-ogee': {
      samples: 18,
      proudAt: (t) => {
        const sCurve = 0.5 - 0.5 * Math.cos(Math.PI * t)
        const reverse = 0.18 * Math.sin(2 * Math.PI * (t - 0.12))
        return clamp01(0.42 + 0.55 * sCurve + reverse)
      },
    },
    'crown-craftsman': {
      samples: 10,
      proudAt: (t) => {
        if (t < 0.16) return 0.48
        if (t < 0.4) return 0.88
        if (t < 0.78) return 0.64
        return 1
      },
    },
    'crown-layered': {
      samples: 14,
      proudAt: (t) => {
        if (t < 0.12) return 0.46
        if (t < 0.28) return 0.82
        if (t < 0.48) return 0.56
        if (t < 0.72) return 0.9
        return 1
      },
    },
  },
  chairRail: {
    flat: {
      samples: 8,
      proudAt: (t) => (t < 0.18 || t > 0.82 ? 0.58 : 0.95),
    },
    bevel: {
      samples: 10,
      proudAt: (t) => 0.45 + 0.45 * Math.sin(Math.PI * t),
    },
    triangle: {
      samples: 10,
      proudAt: (t) => 0.35 + 0.65 * (1 - Math.abs(2 * t - 1)),
    },
    cove: {
      samples: 12,
      proudAt: (t) => 0.42 + 0.42 * Math.sin(Math.PI * t),
    },
    bullnose: {
      samples: 14,
      proudAt: (t) => 0.34 + 0.66 * Math.sin(Math.PI * t),
    },
    'rail-rounded': {
      samples: 14,
      proudAt: (t) => 0.34 + 0.66 * Math.sin(Math.PI * t),
    },
    'rail-ogee': {
      samples: 16,
      proudAt: (t) => {
        const center = Math.sin(Math.PI * t)
        const twist = 0.14 * Math.sin(2 * Math.PI * t)
        return clamp01(0.36 + 0.58 * center + twist)
      },
    },
    'rail-picture': {
      samples: 12,
      proudAt: (t) => {
        if (t < 0.18) return 0.48
        if (t < 0.4) return 0.92
        if (t < 0.74) return 0.58
        return 1
      },
    },
    'rail-stepped': {
      samples: 10,
      proudAt: (t) => {
        if (t < 0.22) return 0.55
        if (t < 0.78) return 1
        return 0.62
      },
    },
  },
}

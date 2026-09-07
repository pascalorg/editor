import type { DefaultXRInputSourceRayPointerOptions } from '@react-three/xr'

export const POINTER_CURSOR_MIN_SIZE = 0.012
export const POINTER_CURSOR_MAX_SIZE = 0.14
export const POINTER_CURSOR_INNER_RADIUS = 0.32
export const POINTER_CURSOR_OUTER_RADIUS = 0.5

export function resolvePointerCursorSize(distance: number): number {
  if (!Number.isFinite(distance)) return POINTER_CURSOR_MIN_SIZE
  return Math.max(POINTER_CURSOR_MIN_SIZE, Math.min(POINTER_CURSOR_MAX_SIZE, distance * 0.06))
}

export const DISTANCE_AWARE_RAY_POINTER_OPTIONS = {
  clickThresholdMs: Number.POSITIVE_INFINITY,
  minDistance: 0,
  rayModel: {
    color: '#7dd3fc',
  },
  cursorModel: {
    color: '#7dd3fc',
    opacity: 0.9,
    cursorOffset: 0.008,
  },
} satisfies DefaultXRInputSourceRayPointerOptions

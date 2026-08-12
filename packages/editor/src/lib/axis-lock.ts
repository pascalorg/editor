import type { PlanPoint } from './measurement-input'

/**
 * Momentary axis lock for drafting, on the arrow keys — SketchUp's own binding,
 * and the keys this editor had left free.
 *
 * This is deliberately *not* Shift. Shift taps to cycle the snapping mode and
 * that is a settled part of the interaction contract (see
 * `wiki/architecture/interaction-scope.md`); taking it here would undo a
 * completed migration. The lock is a separate, explicit constraint that sits on
 * top of whichever snapping mode is active.
 *
 * Plan space is XZ with Y up, so only `x` and `z` mean anything to the plan
 * drafting paths. `↑` is intentionally left unbound rather than pointed at a
 * vertical lock that those paths cannot honour.
 */
export type DraftAxis = 'x' | 'z'

export const AXIS_LOCK_KEYS: Record<string, DraftAxis> = {
  ArrowRight: 'x',
  ArrowLeft: 'z',
}

/** Colour role per axis, matching the axis guides already drawn in both views. */
export const AXIS_LABELS: Record<DraftAxis, string> = {
  x: 'On X axis',
  z: 'On Z axis',
}

/**
 * Project the cursor onto the locked axis through `start`. The locked
 * coordinate is the one that stops moving: locking to X keeps the draft on the
 * start point's Z, so the segment can only run along X.
 */
export function applyAxisLock(start: PlanPoint, cursor: PlanPoint, axis: DraftAxis): PlanPoint {
  return axis === 'x' ? [cursor[0], start[1]] : [start[0], cursor[1]]
}

'use client'

import { create } from 'zustand'
import type { DraftAxis } from '../lib/axis-lock'
import { isActive } from '../lib/interaction/scope'
import useInteractionScope from './use-interaction-scope'

// The momentary axis lock (arrow keys) applied to the active draft. Held apart
// from the snapping mode on purpose: the mode is a persisted, per-context
// preference shown on the HUD chip, while this is a constraint that belongs to
// one gesture and disappears with it.

export type AxisLockState = {
  axis: DraftAxis | null
  /** Pressing the same axis again releases it, matching SketchUp. */
  toggle: (axis: DraftAxis) => void
  clear: () => void
}

const useAxisLock = create<AxisLockState>((set) => ({
  axis: null,
  toggle: (axis) => set((state) => ({ axis: state.axis === axis ? null : axis })),
  clear: () => set((state) => (state.axis === null ? state : { axis: null })),
}))

// Tied to the same atomic-end invariant as the typed-dimension buffer: the
// moment the scope returns to idle the lock is gone, so it cannot leak into the
// next gesture.
useInteractionScope.subscribe((state, previous) => {
  if (isActive(previous.scope) && !isActive(state.scope)) {
    useAxisLock.getState().clear()
  }
})

/** Imperative read for the snap resolvers. */
export function getAxisLock(): DraftAxis | null {
  return useAxisLock.getState().axis
}

export default useAxisLock

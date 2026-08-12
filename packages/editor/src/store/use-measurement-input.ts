'use client'

import { useViewer } from '@pascal-app/viewer'
import { create } from 'zustand'
import { isActive } from '../lib/interaction/scope'
import {
  applyFixedLength,
  bareLengthUnit,
  type MeasurementInputField,
  type PlanPoint,
  resolveMeasurementInput,
} from '../lib/measurement-input'
import useInteractionScope from './use-interaction-scope'

// The typed-dimension buffer ("measurements box"). While an interaction is in
// flight the user types a value and the interaction re-resolves to exactly that
// value instead of whatever the cursor proposed — no dialog, no focus change.
//
// The buffer only ever fills while an interaction scope is active (see
// `use-keyboard`), which is what keeps the single-letter tool shortcuts intact:
// at idle every key still means what it always meant.

export type MeasurementInputState = {
  /** Raw text as typed. Empty means "the cursor is still driving". */
  buffer: string
  /** What the active interaction is asking for. */
  field: MeasurementInputField
  /** Start (or continue) typing. */
  append: (char: string) => void
  backspace: () => void
  clear: () => void
  setField: (field: MeasurementInputField) => void
}

const useMeasurementInput = create<MeasurementInputState>((set) => ({
  buffer: '',
  field: 'length',
  append: (char) => set((state) => ({ buffer: state.buffer + char })),
  backspace: () => set((state) => ({ buffer: state.buffer.slice(0, -1) })),
  clear: () => set((state) => (state.buffer === '' ? state : { buffer: '' })),
  setField: (field) => set({ field }),
}))

// A typed value belongs to the interaction that was running when it was typed.
// Rather than making every interaction body remember to clear it, the buffer is
// tied to the same atomic-end invariant the scope already guarantees: the moment
// the scope returns to idle, the buffer is empty. No typed value can leak into
// the next gesture.
useInteractionScope.subscribe((state, previous) => {
  if (isActive(previous.scope) && !isActive(state.scope)) {
    useMeasurementInput.getState().clear()
  }
})

/**
 * Unit a bare number is read in, from the viewer's live display preference.
 * Read at parse time (not captured) so switching the unit toggle mid-draft
 * reinterprets what is already typed, matching how the readouts behave.
 */
export function getMeasurementInputBareUnit(): string {
  const { unit, metricNotation } = useViewer.getState()
  return bareLengthUnit(unit, metricNotation)
}

/**
 * The typed value in stored units (metres / radians), or `null` while the text
 * is empty or not yet a complete quantity — the signal for a tool to keep using
 * its cursor-driven value.
 */
export function getMeasurementInputValue(): number | null {
  const { buffer, field } = useMeasurementInput.getState()
  if (!buffer) return null
  return resolveMeasurementInput(buffer, field, getMeasurementInputBareUnit())
}

/** Imperative read for pointer handlers that only need "is the user typing?". */
export function isMeasurementInputActive(): boolean {
  return useMeasurementInput.getState().buffer !== ''
}

/**
 * The draft point a typed length asks for, or `null` when nothing usable is
 * typed — in which case the caller keeps whatever its snapping produced.
 *
 * `directionTarget` is the point the cursor is proposing *after* any angle lock,
 * so the typed value only ever replaces the distance. Every segment drafting
 * path routes through here so the "typed beats snapping" rule cannot drift
 * between kinds.
 */
export function resolveTypedLengthPoint(
  start: PlanPoint,
  directionTarget: PlanPoint,
): PlanPoint | null {
  const typed = getMeasurementInputValue()
  if (typed === null) return null
  return applyFixedLength(start, directionTarget, typed)
}

export default useMeasurementInput

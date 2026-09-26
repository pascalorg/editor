import { create } from 'zustand'
import { parseMeasurement } from '../lib/measurement-parser'

/**
 * Typed-length editing for the two-click wall drafting flow (#308).
 *
 * Shared by the 3D wall tool (`packages/nodes/src/wall/tool.tsx`) and the 2D
 * floor-plan wall draft (`floorplan-panel.tsx`) so both views show the same
 * typing buffer and commit it identically. While a buffer is active the draft
 * endpoint is projected onto the typed length along the current draft
 * direction; Enter commits, Escape (stage 1) clears the buffer, Escape (stage
 * 2) cancels the draft.
 */
type WallDraftTypingState = {
  input: string
  /**
   * Last projected draft endpoint (scene-local X/Z) published by whichever
   * view is driving the draft. Click commits must reuse this point when a
   * buffer is active so the committed wall matches the preview exactly
   * instead of re-deriving it from the raw pointer.
   */
  projectedEnd: [number, number] | null
  append(key: string): void
  backspace(): void
  clearInput(): void
  setProjectedEnd(end: [number, number] | null): void
}

export const useWallDraftTyping = create<WallDraftTypingState>((set) => ({
  input: '',
  projectedEnd: null,
  append: (key) => set((state) => ({ input: state.input + key })),
  backspace: () =>
    set((state) => ({ input: state.input.slice(0, Math.max(0, state.input.length - 1)) })),
  clearInput: () => set({ input: '', projectedEnd: null }),
  setProjectedEnd: (end) => set({ projectedEnd: end }),
}))

/** Keys the wall typing buffer accepts (digits, unit letters, separators). */
export function isWallTypingKey(key: string): boolean {
  return key.length === 1 && /^[0-9a-zA-Z.'"+\- ]$/.test(key)
}

/**
 * Re-derive the typed commit endpoint at commit time from the live draft
 * direction. `append`/`backspace` only change the buffer — the projected
 * endpoint published by the last pointer move goes stale the moment more
 * digits arrive, so a click must not trust it (Bugbot 8497d792: "click
 * commits stale typed length"). Enter already recomputed; click now does
 * too, so both exits commit exactly what the HUD shows.
 *
 * `currentEnd` is the last previewed draft end (already typed-length
 * projected by the previous move): its direction from `start` is the
 * pointer-steered ray, unaffected by how stale its length is.
 *
 * Returns null when there is no usable buffer (empty / unparseable /
 * non-positive) or no direction (pointer still on the start point) —
 * callers fall back to the store's last `projectedEnd`, then the raw point.
 */
export function resolveTypedCommitEnd(
  start: [number, number],
  currentEnd: [number, number],
  input: string,
  parseOptions: Parameters<typeof parseMeasurement>[2],
): [number, number] | null {
  if (!input) return null
  const value = parseMeasurement(input, { kind: 'length', unitId: 'm' }, parseOptions)
  if (value === null || value <= 0) return null
  const dx = currentEnd[0] - start[0]
  const dz = currentEnd[1] - start[1]
  const length = Math.hypot(dx, dz)
  if (length <= 1e-6) return null
  return [start[0] + (dx / length) * value, start[1] + (dz / length) * value]
}

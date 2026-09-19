import { create } from 'zustand'

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
  begin(): void
  append(key: string): void
  backspace(): void
  clearInput(): void
}

export const useWallDraftTyping = create<WallDraftTypingState>((set) => ({
  input: '',
  begin: () => set({ input: '' }),
  append: (key) => set((state) => ({ input: state.input + key })),
  backspace: () =>
    set((state) => ({ input: state.input.slice(0, Math.max(0, state.input.length - 1)) })),
  clearInput: () => set({ input: '' }),
}))

/** Keys the wall typing buffer accepts (digits, unit letters, separators). */
export function isWallTypingKey(key: string, buffer = ''): boolean {
  if (key.length !== 1 || !/^[0-9a-zA-Z.'"+\- ]$/.test(key)) return false
  // Empty buffer may only start from a digit or decimal — letters / Space /
  // unit suffixes must not swallow draft-time shortcuts such as `c`.
  if (buffer.length === 0) return /^[0-9.]$/.test(key)
  return true
}

/** Floorplan Space-pan must not steal a mid-entry typed length, or a key 3D already owned. */
export function shouldArmFloorplanSpacePan(args: {
  defaultPrevented: boolean
  isFloorplanOpen: boolean
  isWallBuildActive: boolean
  hasDraftStart: boolean
  typingBuffer: string
}): boolean {
  if (!args.isFloorplanOpen || args.defaultPrevented) return false
  if (args.isWallBuildActive && args.hasDraftStart && args.typingBuffer.length > 0) {
    return false
  }
  return true
}

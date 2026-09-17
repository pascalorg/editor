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
export function isWallTypingKey(key: string): boolean {
  return key.length === 1 && /^[0-9a-zA-Z.'"+\- ]$/.test(key)
}

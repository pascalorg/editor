import type { RevealCandidate } from './reveal-schedule'

/**
 * The nodes a construction reveal holds back until their turn, by id. Kept apart from the reveal
 * component so the systems that build hosts read it without pulling in React.
 */
export const revealPending = new Map<string, RevealCandidate>()

/**
 * Whether the node waits for its turn. A host builds without what waits in it: a wall cuts no
 * hole for a window before the window's turn (Victor run 12).
 */
export function isRevealWaiting(id: string): boolean {
  return revealPending.has(id)
}

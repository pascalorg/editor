// Counting what an ask's turn wrote in the scene's undo history. The history is bounded (the last
// 50 steps) and the person can Cmd+Z into it, so a length cannot say how many steps are the turn's:
// a mark holds the last step standing when the turn began, and the steps since are counted from
// where that step is now.

export type HistoryMark = { ref: unknown | null; length: number }

export function markHistory(past: readonly unknown[]): HistoryMark {
  return { ref: past.at(-1) ?? null, length: past.length }
}

/**
 * How many steps were pushed since `mark`, or null when the marked step is gone from the history
 * (it fell off the front, or the person undid back past it): the turn can no longer be undone as a
 * whole.
 */
export function stepsSince(past: readonly unknown[], mark: HistoryMark): number | null {
  if (mark.ref === null) return past.length
  const at = past.lastIndexOf(mark.ref)
  return at < 0 ? null : past.length - 1 - at
}

/**
 * The history state the turn's first step was taken from: the scene as it stood when the turn began.
 * Null when nothing was pushed since the mark, or the marked step has gone from the history.
 */
export function stateAfterMark<T>(past: readonly T[], mark: HistoryMark): T | null {
  if (mark.ref === null) return past[0] ?? null
  const at = past.lastIndexOf(mark.ref as T)
  return at < 0 ? null : (past[at + 1] ?? null)
}

/** The nodes in `now` that `before` had no entry for: what an undo of the steps in between will remove. */
export function createdSince(
  before: Record<string, unknown>,
  now: Record<string, unknown>,
): string[] {
  return Object.keys(now).filter((id) => !(id in before))
}

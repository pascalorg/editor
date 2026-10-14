import type { RevealPhase, SceneCommit } from '@pascal-app/core'
import { type ConstructionRevealLevel, commitRevealCandidates } from './reveal-candidates'
import { planReveal, REVEAL_TIMING, type RevealTiming, revealGroupKey } from './reveal-schedule'

/** When one (phase, level) group of a reveal plays. */
export type RevealWindow = {
  phase: RevealPhase
  levelId: string | null
  /** When its first node starts, in ms from the reveal's first frame. */
  startMs: number
  /** When its last node has finished moving in. */
  endMs: number
}

/**
 * The (phase, level) windows `ConstructionReveal` plays for `commit` at
 * `level`, as it plans them when nothing else is revealing, in ms from the
 * reveal's first frame after the commit. For a presentation that plays beside
 * the reveal (a plugin's own layer) and must land before a group ends.
 *
 * A second commit arriving mid-reveal is planned together with what is still
 * waiting, so its real windows can shift from these.
 */
export function planRevealWindows(
  commit: SceneCommit,
  level: ConstructionRevealLevel = 'full',
  timing: RevealTiming = REVEAL_TIMING,
): RevealWindow[] {
  const windows = new Map<string, RevealWindow>()
  for (const entry of planReveal(commitRevealCandidates(commit, level), 0, timing)) {
    const endMs = entry.startMs + timing.durationMs[entry.style]
    const key = revealGroupKey(entry)
    const window = windows.get(key)
    if (!window) {
      windows.set(key, {
        phase: entry.phase,
        levelId: entry.levelId,
        startMs: entry.startMs,
        endMs,
      })
      continue
    }
    window.startMs = Math.min(window.startMs, entry.startMs)
    window.endMs = Math.max(window.endMs, endMs)
  }
  return [...windows.values()]
}

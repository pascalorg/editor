import type { SceneHistoryPrunePolicy } from './types'

/**
 * Defaults for what a scene keeps of its own past.
 *
 * The numbers are a retention policy, not a tuning knob: 20 checkpoints is what
 * "show me an earlier version" needs, and 7 days covers the case where someone
 * broke something on Friday and noticed on Monday. Both apply — a checkpoint
 * younger than the window survives even past the count.
 */
export const DEFAULT_HISTORY_POLICY = {
  keepCheckpoints: 20,
  keepDays: 7,
  keepEvents: 500,
} as const satisfies Required<SceneHistoryPrunePolicy>

function positiveInt(value: unknown, fallback: number): number {
  const parsed = typeof value === 'string' ? Number.parseInt(value, 10) : Number(value)
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback
}

/**
 * Resolves the effective policy. Explicit arguments win over the environment,
 * which wins over the defaults, so a deploy can tighten retention without a
 * release and a test can pin it without touching the environment.
 */
export function resolveHistoryPolicy(
  policy: SceneHistoryPrunePolicy | undefined,
  env: NodeJS.ProcessEnv = process.env,
): Required<SceneHistoryPrunePolicy> {
  return {
    keepCheckpoints:
      policy?.keepCheckpoints ??
      positiveInt(env.PASCAL_HISTORY_KEEP_CHECKPOINTS, DEFAULT_HISTORY_POLICY.keepCheckpoints),
    keepDays:
      policy?.keepDays ??
      positiveInt(env.PASCAL_HISTORY_KEEP_DAYS, DEFAULT_HISTORY_POLICY.keepDays),
    keepEvents:
      policy?.keepEvents ??
      positiveInt(env.PASCAL_HISTORY_KEEP_EVENTS, DEFAULT_HISTORY_POLICY.keepEvents),
  }
}

/** ISO cutoff for `keepDays`, or `null` when the window is unbounded. */
export function retentionCutoff(keepDays: number, now: Date = new Date()): string | null {
  if (keepDays <= 0) return null
  return new Date(now.getTime() - keepDays * 24 * 60 * 60 * 1000).toISOString()
}

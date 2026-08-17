import type { SceneHistoryPrunePolicy } from './types'

/**
 * Defaults for what a scene keeps of its own past.
 *
 * Two rules, unioned. The newest `keepCheckpoints` cover "undo my afternoon".
 * The `keepDays` window covers "it broke sometime last week" — and it keeps
 * *one row per day*, not every row from those days. That distinction is the
 * whole point: checkpoints land every five minutes while someone is editing, so
 * a rule that kept everything inside the window would keep a thousand rows a
 * week and only start collecting on day eight.
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

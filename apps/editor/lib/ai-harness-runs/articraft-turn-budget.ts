const DEFAULT_ARTICRAFT_MAX_TURNS = 100
const MIN_ARTICRAFT_MAX_TURNS = 1
const MAX_ARTICRAFT_MAX_TURNS = 250

function parseTurnCount(value: unknown): number | undefined {
  const numeric = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN
  if (!Number.isFinite(numeric)) return undefined
  return Math.max(
    MIN_ARTICRAFT_MAX_TURNS,
    Math.min(MAX_ARTICRAFT_MAX_TURNS, Math.round(numeric)),
  )
}

export function resolveArticraftMaxTurns(_prompt: string, requestedMaxTurns?: unknown): number {
  return (
    parseTurnCount(requestedMaxTurns) ??
    parseTurnCount(process.env.ARTICRAFT_AI_MAX_TURNS) ??
    DEFAULT_ARTICRAFT_MAX_TURNS
  )
}

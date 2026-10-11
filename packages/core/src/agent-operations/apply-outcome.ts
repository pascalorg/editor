import type { AgentOperationOutcome, SceneChanges, SceneNodes } from './types'

/** What a surface lends an operation's outcome: its scene, its writes and its reconciler. */
export type AgentHostRuntime = {
  getNodes: () => SceneNodes
  applyChanges: (changes: SceneChanges) => void
  /** Derive construction from the scene as it now is: rooms, auto ceilings, floor plates. */
  reconcile: () => void
}

/**
 * Applies an operation's outcome through a host and returns the answer: its changes, then for an
 * outcome that reads derived construction, the reconcile, its follow-up changes and a second
 * reconcile. The host frames the call as one undo step.
 */
export function applyAgentOutcome(
  outcome: AgentOperationOutcome,
  runtime: AgentHostRuntime,
): Record<string, unknown> {
  if (outcome.changes) runtime.applyChanges(outcome.changes)
  if (!outcome.afterReconcile) return outcome.result
  runtime.reconcile()
  const settled = outcome.afterReconcile(runtime.getNodes())
  if (settled.changes) {
    runtime.applyChanges(settled.changes)
    runtime.reconcile()
  }
  return settled.result
}

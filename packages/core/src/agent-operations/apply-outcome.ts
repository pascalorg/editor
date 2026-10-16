import { madeEntries, type SessionKeep } from './scene-checkpoint'
import type { AgentOperationOutcome, SceneChanges, SceneNodes } from './types'

/** What a surface lends an operation's outcome: its scene, its writes and its reconciler. */
export type AgentHostRuntime = {
  getNodes: () => SceneNodes
  applyChanges: (changes: SceneChanges) => void
  /** Derive construction from the scene as it now is: rooms, auto ceilings, floor plates. */
  reconcile: () => void
  /**
   * Keeps what the agent's session should remember: the checkpoint an operation took and the nodes
   * a write created. The host stores it where its sessions live, never in the scene.
   */
  keep?: (keep: SessionKeep) => void
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
  const written: SceneChanges[] = []
  if (outcome.changes) {
    runtime.applyChanges(outcome.changes)
    written.push(outcome.changes)
  }
  let result = outcome.result
  if (outcome.afterReconcile) {
    runtime.reconcile()
    const settled = outcome.afterReconcile(runtime.getNodes())
    if (settled.changes) {
      runtime.applyChanges(settled.changes)
      written.push(settled.changes)
      runtime.reconcile()
    }
    result = settled.result
  }
  if (runtime.keep) {
    const made = madeEntries(runtime.getNodes(), written)
    if (
      outcome.keep?.checkpoint ||
      outcome.keep?.designBrief !== undefined ||
      outcome.keep?.viewed !== undefined ||
      made.length
    )
      runtime.keep({ ...outcome.keep, ...(made.length ? { made } : {}) })
  }
  return result
}

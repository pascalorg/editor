import { coherenceOfChange } from '../coherence'
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
 * reconcile. The host frames the call as one undo step. A write that reaches a level answers with
 * what it did to the scene's coherence checklist: the contacts it introduced and resolved.
 */
export function applyAgentOutcome(
  outcome: AgentOperationOutcome,
  runtime: AgentHostRuntime,
): Record<string, unknown> {
  // A copy: a host may write its own map in place, and a "before" that grows with the call reads
  // every introduction as already there.
  const before = outcome.changes || outcome.afterReconcile ? { ...runtime.getNodes() } : null
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
  const coherence = before ? coherenceOfChange(before, runtime.getNodes(), written) : null
  if (runtime.keep) {
    const made = madeEntries(runtime.getNodes(), written)
    if (outcome.keep?.checkpoint || made.length)
      runtime.keep({ ...outcome.keep, ...(made.length ? { made } : {}) })
  }
  return coherence ? { ...result, coherence } : result
}

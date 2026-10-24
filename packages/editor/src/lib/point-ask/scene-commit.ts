import { type AnyNodeId, areSemanticValuesEqual, type SceneCommit } from '@pascal-app/core'
import type { PinEvent } from './pin-machine'
import { pointTargetScope } from './target-scope'

/** Node metadata is optional on the commit bus; classify real changes, not fresh equal clones. */
export function pointCommitEvent(
  commit: SceneCommit,
  targetIds: readonly string[],
): Extract<PinEvent, { type: 'commit' }> | null {
  // Host/load snapshots do not belong to the local turn or its Undo history.
  if (commit.origin !== 'local') return null
  let changedNodeIds = [...(commit.changedNodeIds ?? [])]
  if (changedNodeIds.length === 0 && commit.before.nodes !== commit.current.nodes) {
    const ids = new Set<AnyNodeId>([
      ...(Object.keys(commit.before.nodes) as AnyNodeId[]),
      ...(Object.keys(commit.current.nodes) as AnyNodeId[]),
    ])
    changedNodeIds = [...ids].filter(
      (id) => !areSemanticValuesEqual(commit.before.nodes[id], commit.current.nodes[id]),
    )
  }
  const scope =
    changedNodeIds.length > 0
      ? pointTargetScope(targetIds, commit.before.nodes, commit.current.nodes)
      : null
  return {
    type: 'commit',
    changedNodeIds,
    committed: true,
    ...(scope ? { isInTargets: (id: string) => scope.has(id) } : {}),
  }
}

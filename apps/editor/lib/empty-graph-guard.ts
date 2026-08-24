/**
 * Guard shared by the scene-save client path and the scenes API PUT route:
 * an incoming graph with ZERO nodes must never silently replace a server copy
 * that has nodes.
 *
 * Rationale (scene-wipe class, 2026-08-16..18): an editor session whose store
 * has not hydrated yet (load in flight, failed GET, pre-hydration flush) can
 * serialize an empty graph. Persisting it destroys the scene at the next
 * version. Losing a save of a legitimately-emptied scene is far rarer and is
 * recoverable (scene_revisions keeps every version), so the trade is blocking
 * empty overwrites by default and requiring an explicit `force` to allow them.
 */

export function countGraphNodes(
  graph: { nodes?: Record<string, unknown> | null } | null | undefined,
): number {
  if (!graph?.nodes || typeof graph.nodes !== 'object') return 0
  return Object.keys(graph.nodes).length
}

export function isEmptyGraphOverwrite(
  incomingNodeCount: number,
  knownServerNodeCount: number,
): boolean {
  return incomingNodeCount === 0 && knownServerNodeCount > 0
}

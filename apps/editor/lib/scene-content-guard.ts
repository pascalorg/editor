/**
 * Guard against a save that silently destroys an authored scene.
 *
 * The editor autosaves on a debounce. If that timer fires before the initial
 * scene load resolves, the client sends the empty graph it started from — or
 * the bare site/building/level scaffold it falls back to. The stored version is
 * still the one the client read, so `expectedVersion` matches and optimistic
 * concurrency waves the write through. The authored scene is then gone.
 *
 * Shrinking a scene is legitimate; removing its last authored node as part of
 * an unattended write is not distinguishable from the failure above, so callers
 * that mean it have to say so explicitly.
 */

/**
 * The scaffold a fresh editor session starts from. These carry no authored
 * content on their own, so a graph containing only these is "empty" for the
 * purposes of this guard.
 */
export const SCAFFOLD_NODE_TYPES: ReadonlySet<string> = new Set(['site', 'building', 'level'])

/** Counts nodes a user or agent actually authored (walls, slabs, zones, openings, roofs, items). */
export function countContentNodes(graph: unknown): number {
  const nodes = (graph as { nodes?: Record<string, { type?: string } | null> } | null | undefined)
    ?.nodes
  if (!nodes || typeof nodes !== 'object') return 0

  let count = 0
  for (const node of Object.values(nodes)) {
    const type = node?.type
    if (typeof type === 'string' && !SCAFFOLD_NODE_TYPES.has(type)) count += 1
  }
  return count
}

/**
 * True when writing `incoming` over `existing` would strip the scene of every
 * authored node. Callers should reject such a write unless it is explicit.
 */
export function wouldClearSceneContent(existing: unknown, incoming: unknown): boolean {
  return countContentNodes(existing) > 0 && countContentNodes(incoming) === 0
}

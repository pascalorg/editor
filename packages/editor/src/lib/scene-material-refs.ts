import {
  type AnyNode,
  getSceneMaterialIdFromRef,
  type SceneMaterialId,
  toSceneMaterialRef,
} from '@pascal-app/core'

// Where a scene material (`scene:<id>`) is used. A node carries refs in more
// places than its `slots`: a room's floor finish and floor regions, its wall
// material and per-wall overrides, its floor step finishes (room-wide and per
// doorway) and edge finish, a wall's face paint regions, a footprint's edge
// band (`slots.edge`) and foundation.
// Every string ref anywhere in a node counts, so a new finish location is
// covered without touching this walker. The usage count, preset/room saving
// and pasting all walk the same way, so they always agree.

/** Calls `visit` with the material id of every `scene:` ref inside `value`, once per use. */
export function forEachSceneMaterialRef(value: unknown, visit: (id: SceneMaterialId) => void) {
  if (typeof value === 'string') {
    const id = getSceneMaterialIdFromRef(value)
    if (id) visit(id as SceneMaterialId)
    return
  }
  if (Array.isArray(value)) {
    for (const entry of value) forEachSceneMaterialRef(entry, visit)
    return
  }
  if (value && typeof value === 'object')
    for (const entry of Object.values(value)) forEachSceneMaterialRef(entry, visit)
}

/** The scene materials `value` references (a node, a list of nodes, …). */
export function referencedSceneMaterialIds(value: unknown): Set<SceneMaterialId> {
  const ids = new Set<SceneMaterialId>()
  forEachSceneMaterialRef(value, (id) => ids.add(id))
  return ids
}

/** How many parts use each scene material across `nodes` (one per finish or slot). */
export function sceneMaterialUsageCounts(
  nodes: Record<string, AnyNode>,
): Map<SceneMaterialId, number> {
  const counts = new Map<SceneMaterialId, number>()
  for (const node of Object.values(nodes))
    forEachSceneMaterialRef(node, (id) => counts.set(id, (counts.get(id) ?? 0) + 1))
  return counts
}

/**
 * `value` with every `scene:<old>` ref the map knows rewritten to `scene:<new>`.
 * Unchanged branches keep their identity, so an untouched node comes back as-is.
 */
export function remapSceneMaterialRefs<T>(value: T, idMap: ReadonlyMap<string, string>): T {
  if (typeof value === 'string') {
    const id = getSceneMaterialIdFromRef(value)
    const next = id ? idMap.get(id) : undefined
    return (next && next !== id ? toSceneMaterialRef(next) : value) as T
  }
  if (Array.isArray(value)) {
    let changed = false
    const next = value.map((entry) => {
      const mapped = remapSceneMaterialRefs(entry, idMap)
      if (mapped !== entry) changed = true
      return mapped
    })
    return (changed ? next : value) as T
  }
  if (value && typeof value === 'object') {
    let changed = false
    const next: Record<string, unknown> = {}
    for (const [key, entry] of Object.entries(value)) {
      const mapped = remapSceneMaterialRefs(entry, idMap)
      if (mapped !== entry) changed = true
      next[key] = mapped
    }
    return (changed ? next : value) as T
  }
  return value
}

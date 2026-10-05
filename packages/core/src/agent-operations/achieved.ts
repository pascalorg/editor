import { applySceneChanges } from './apply-changes'
import type { SceneChanges, SceneNodes } from './types'

export type Achieved = {
  created: Record<string, number>
  updated: number
  deleted: Record<string, number>
  /** The call left the scene as it was: what it reports was not built. */
  unchanged?: true
}

const countByType = (ids: Iterable<string>, nodes: SceneNodes) => {
  const counts: Record<string, number> = {}
  for (const id of ids) {
    const type = nodes[id]?.type
    if (type) counts[type] = (counts[type] ?? 0) + 1
  }
  return counts
}

/**
 * What a mutating call really changed, read from the scene before and after its changes, so a
 * result never claims what the scene does not hold (Victor run 8: a facade "applied" on 432 walls
 * that placed no window). Cheap: one pass over the ids; a scene check per call is not (2.7 s on
 * the 4,362 nodes of Victor run 10).
 */
export function achievedChanges(before: SceneNodes, changes: SceneChanges): Achieved {
  const after = applySceneChanges(before as never, changes) as SceneNodes
  const created = Object.keys(after).filter((id) => !(id in before))
  const deleted = Object.keys(before).filter((id) => !(id in after))
  const updated = (changes.update ?? []).filter(
    ({ id }) => id in before && id in after && before[id] !== after[id],
  ).length
  return {
    created: countByType(created, after),
    updated,
    deleted: countByType(deleted, before),
    ...(created.length || deleted.length || updated ? {} : { unchanged: true as const }),
  }
}

import { type AnyNodeId, nodeRegistry, sceneRegistry, useScene } from '@pascal-app/core'

/**
 * Which dirty nodes a capture or the scene-ready gate waits for: the ones some system still has to
 * build or load. The viewer's own systems clear their kinds' marks; a plugin kind that declares
 * `def.system` is expected to clear its own (plugin-trees does), and until it does it reads as
 * building. A kind whose system never clears it holds the count for good, which is why a caller
 * that waits reads a count that stops moving as nodes no system settles and can set them aside
 * (`pendingSceneBuildCount`'s `except`).
 */

const DIRTY_BUILD_KINDS = new Set([
  'ceiling',
  'door',
  'item',
  'roof',
  'roof-segment',
  'stair',
  'stair-segment',
  'wall',
  'window',
])

type SceneGraphState = Pick<ReturnType<typeof useScene.getState>, 'nodes' | 'rootNodeIds'>

function isPendingSceneBuild(id: AnyNodeId, { nodes, rootNodeIds }: SceneGraphState): boolean {
  const node = nodes[id]
  if (!node) return false
  // Unreachable nodes (orphaned by a broken detach: the parent doesn't list
  // them in `children`, or no parent and not a root) never render — every
  // renderer enumerates the parent's `children` array — so no system will
  // ever build them or clear their mark. They must not hold scene-ready
  // hostage (observed in prod scene data: two dangling windows kept every
  // bake of that scene waiting out the full readiness cap).
  const parent = node.parentId ? nodes[node.parentId as AnyNodeId] : undefined
  const reachable = parent
    ? (parent as { children?: string[] }).children?.includes(id) === true
    : rootNodeIds.includes(id)
  if (!reachable) return false
  const def = nodeRegistry.get(node.type)
  return Boolean(
    def?.geometry || def?.capabilities?.floorPlaced || DIRTY_BUILD_KINDS.has(node.type),
  )
}

/** The graph's root has mounted (a scene still on its placeholder has nothing to settle yet). */
export function hasCommittedSceneRoot() {
  const { nodes, rootNodeIds } = useScene.getState()
  if (rootNodeIds.length === 0) return Object.keys(nodes).length === 0
  return rootNodeIds.some((id) => sceneRegistry.nodes.has(id))
}

/** Whether any dirty node still has to be built or loaded; stops at the first. */
export function hasPendingSceneBuildNode(): boolean {
  const state = useScene.getState()
  for (const id of state.dirtyNodes) {
    if (isPendingSceneBuild(id, state)) return true
  }
  return false
}

/** The dirty nodes still to build or load. */
export function pendingSceneBuildNodeIds(): Set<string> {
  const state = useScene.getState()
  const ids = new Set<string>()
  for (const id of state.dirtyNodes) {
    if (isPendingSceneBuild(id, state)) ids.add(id)
  }
  return ids
}

/**
 * The pending count: dirty nodes still to build or load, plus `roofMerges` (a roof's dirty mark
 * clears when its merged shell is queued, frames before it is built), or 1 while the graph has
 * not mounted. `except` sets nodes aside — those a waiting capture found no system settles; a
 * node dirtied after that is not among them and counts.
 */
export function countPendingSceneBuild(roofMerges: number, except?: ReadonlySet<string>): number {
  if (!hasCommittedSceneRoot()) return 1
  const state = useScene.getState()
  let count = roofMerges
  for (const id of state.dirtyNodes) {
    if (except?.has(id)) continue
    if (isPendingSceneBuild(id, state)) count++
  }
  return count
}

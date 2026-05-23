import type { SceneGraph } from '@pascal-app/core/clone-scene-graph'

/**
 * Previously re-embedded `SiteNode.children` from flat IDs back to full node
 * objects to match the old schema. Since `SiteNode.children` is now
 * `string[]` (upstream change), `cloneSceneGraph` / `forkSceneGraph` already
 * produce the correct form — this function is a no-op kept for call-site
 * compatibility.
 */
export function rehydrateSiteChildren(graph: SceneGraph): SceneGraph {
  return graph
}

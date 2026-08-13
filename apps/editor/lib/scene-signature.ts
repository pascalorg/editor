import type { SceneGraph } from '@pascal-app/editor'

export type PersistedSceneGraph = SceneGraph & {
  collections?: Record<string, unknown>
  savedViews?: Record<string, unknown>
}

/**
 * Identity of a graph for echo detection, compared across a boundary that
 * normalizes: one side is a raw SSE payload, the other is the editor's state
 * after `applySceneGraphToEditor` ran. `setScene` always writes `collections`,
 * `definitions`, `materials` and `installedPlugins`, so a payload that omits
 * them (MCP live
 * sync emits exactly that) has to serialize the same as the store that
 * defaulted them, or the echo reads as a local edit and gets saved back.
 *
 * Every field the PUT body carries has to appear here. A field that is
 * persisted but unsigned makes a local change to *only* that field
 * indistinguishable from an echo, and the save is skipped.
 */
export function sceneGraphSignature(graph: PersistedSceneGraph): string {
  return JSON.stringify({
    nodes: graph.nodes,
    rootNodeIds: graph.rootNodeIds,
    collections: graph.collections ?? {},
    savedViews: graph.savedViews ?? {},
    definitions: graph.definitions ?? {},
    materials: graph.materials ?? {},
    installedPlugins: graph.installedPlugins ?? [],
  })
}

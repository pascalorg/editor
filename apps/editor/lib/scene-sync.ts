import type { SceneGraph } from '@pascal-app/editor'

export type PersistedSceneGraph = SceneGraph & {
  collections?: Record<string, unknown>
}

export function sceneGraphSignature(graph: PersistedSceneGraph): string {
  return JSON.stringify({
    nodes: graph.nodes,
    rootNodeIds: graph.rootNodeIds,
    collections: graph.collections,
    materials: graph.materials,
    installedPlugins: graph.installedPlugins,
  })
}

export function isRemoteSceneEcho(
  lastRemoteGraphJson: string | null,
  graphJson: string,
): boolean {
  return lastRemoteGraphJson === graphJson
}

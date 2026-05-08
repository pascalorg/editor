import { getPascalTruckLocalAsset, isPascalTruckNode } from './lib/pascal-truck'
import type { SceneGraph } from './lib/scene'

type SceneGraphWithCollections = SceneGraph & {
  collections?: Record<string, unknown>
}

export function prepareNavigationSceneGraph<T extends SceneGraphWithCollections>(
  graph: T | null | undefined,
): T | null | undefined {
  if (!graph?.nodes) {
    return graph
  }

  let nextNodes: Record<string, unknown> | null = null
  for (const [nodeId, node] of Object.entries(graph.nodes)) {
    if (!isPascalTruckNode(node)) {
      continue
    }

    const localTruckAsset = getPascalTruckLocalAsset()
    if (
      node.asset?.src === localTruckAsset.src &&
      node.asset?.thumbnail === localTruckAsset.thumbnail
    ) {
      continue
    }

    nextNodes ??= { ...graph.nodes }
    nextNodes[nodeId] = {
      ...node,
      asset: localTruckAsset,
    }
  }

  if (!nextNodes) {
    return graph
  }

  return {
    ...graph,
    nodes: nextNodes,
  } as T
}

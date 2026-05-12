import { getItemMoveVisualState, setItemMoveVisualState } from './lib/item-move-visuals'
import {
  getPascalTruckLocalAsset,
  isPascalTruckNode,
  stripPascalTruckFromSceneGraph,
} from './lib/pascal-truck'
import type { SceneGraph } from './lib/scene'
import { stripTransientMetadata } from './lib/transient'

type SceneGraphWithCollections = SceneGraph & {
  collections?: Record<string, unknown>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasTransientNavigationMetadata(node: unknown) {
  return isRecord(node) && isRecord(node.metadata) && node.metadata.isTransient === true
}

export function prepareNavigationSceneGraph<T extends SceneGraphWithCollections>(
  graph: T | null | undefined,
): T | null | undefined {
  if (!graph?.nodes) {
    return graph
  }

  const withoutTruck = stripPascalTruckFromSceneGraph(graph).sceneGraph as T | null | undefined
  const baseGraph = withoutTruck ?? graph
  let nextNodes: Record<string, unknown> | null =
    withoutTruck === graph ? null : { ...baseGraph.nodes }
  const removedNodeIds = new Set<string>()
  for (const [nodeId, node] of Object.entries(baseGraph.nodes)) {
    if (isPascalTruckNode(node)) {
      const localTruckAsset = getPascalTruckLocalAsset()
      if (
        node.asset?.src !== localTruckAsset.src ||
        node.asset?.thumbnail !== localTruckAsset.thumbnail
      ) {
        nextNodes ??= { ...baseGraph.nodes }
        nextNodes[nodeId] = {
          ...node,
          asset: localTruckAsset,
        }
        continue
      }
    }

    if (hasTransientNavigationMetadata(node)) {
      nextNodes ??= { ...baseGraph.nodes }
      delete nextNodes[nodeId]
      removedNodeIds.add(nodeId)
      continue
    }

    if (isRecord(node) && getItemMoveVisualState(node.metadata) !== null) {
      nextNodes ??= { ...baseGraph.nodes }
      nextNodes[nodeId] = {
        ...node,
        metadata: setItemMoveVisualState(stripTransientMetadata(node.metadata), null),
      }
    }
  }

  if (!nextNodes) {
    return graph
  }

  if (removedNodeIds.size > 0) {
    for (const [nodeId, node] of Object.entries(nextNodes)) {
      if (!isRecord(node) || !Array.isArray(node.children)) {
        continue
      }

      const nextChildren = node.children.filter(
        (childId) => typeof childId !== 'string' || !removedNodeIds.has(childId),
      )
      if (nextChildren.length !== node.children.length) {
        nextNodes[nodeId] = {
          ...node,
          children: nextChildren,
        }
      }
    }
  }

  return {
    ...graph,
    nodes: nextNodes,
    rootNodeIds: baseGraph.rootNodeIds.filter((nodeId) => !removedNodeIds.has(nodeId)),
  } as T
}

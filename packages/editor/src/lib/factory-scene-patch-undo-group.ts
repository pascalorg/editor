import { type AnyNode, type AnyNodeId, useScene } from '@pascal-app/core'
import {
  applyFactoryScenePatchesToGraph,
  buildFactoryScenePatchOperations,
  type FactoryScenePatchOperations,
} from './factory-scene-patch-apply'

export type FactoryScenePatchUndoGroupResult = {
  applied: boolean
  operations: FactoryScenePatchOperations
}

function pruneCollections(
  collections: ReturnType<typeof useScene.getState>['collections'],
  nodes: Record<AnyNodeId, AnyNode>,
) {
  const nextCollections = { ...collections }
  for (const [id, collection] of Object.entries(nextCollections)) {
    nextCollections[id as keyof typeof nextCollections] = {
      ...collection,
      nodeIds: collection.nodeIds.filter((nodeId) => Boolean(nodes[nodeId])),
    }
  }
  return nextCollections
}

export function applyFactoryScenePatchesAsUndoGroup(input: {
  fallbackParentId?: AnyNodeId | null
  patches: unknown[]
}): FactoryScenePatchUndoGroupResult {
  const scene = useScene.getState()
  const operations = buildFactoryScenePatchOperations(input.patches, {
    existingNodeIds: Object.keys(scene.nodes),
    fallbackParentId: input.fallbackParentId,
  })

  if (scene.readOnly) return { applied: false, operations }

  const graph = applyFactoryScenePatchesToGraph(
    {
      nodes: scene.nodes,
      rootNodeIds: scene.rootNodeIds,
    },
    input.patches,
    { fallbackParentId: input.fallbackParentId },
  )
  const graphNodes = graph.nodes as Record<AnyNodeId, AnyNode>
  const graphRootNodeIds = graph.rootNodeIds as AnyNodeId[]
  const dirtyNodes = new Set<AnyNodeId>([
    ...scene.dirtyNodes,
    ...(Object.keys(graphNodes) as AnyNodeId[]),
  ])

  useScene.setState((state) => ({
    collections: pruneCollections(state.collections, graphNodes),
    dirtyNodes,
    nodes: graphNodes,
    rootNodeIds: graphRootNodeIds,
  }))

  return { applied: true, operations }
}

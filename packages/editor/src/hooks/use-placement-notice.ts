import {
  type AnyNode,
  type AnyNodeId,
  type LiveTransformLike,
  nodeRegistry,
  type PlacementNotice,
  useLiveTransforms,
  useScene,
} from '@pascal-app/core'
import { useMemo } from 'react'

/** The notice `nodeId`'s kind gives for where it stands (`placementNotice`), if it declares one. */
export function placementNoticeOf(
  nodes: Readonly<Record<string, AnyNode>>,
  nodeId: string,
  live?: LiveTransformLike,
): PlacementNotice | null {
  const node = nodes[nodeId as AnyNodeId]
  const notice = node ? nodeRegistry.get(node.type)?.placementNotice : undefined
  if (!(node && notice)) return null
  return notice(node as never, live ? { nodes, live } : { nodes })
}

/**
 * What the node in hand, or the selected node, says about where it stands, read at its live pose
 * while it is placed or moved. Subscribes to the scene only while a node is given, so an
 * always-mounted caller doesn't re-render on every write.
 */
export function usePlacementNotice(nodeId: string | null | undefined): PlacementNotice | null {
  const nodes = useScene((state) => (nodeId ? state.nodes : null))
  const live = useLiveTransforms((state) => (nodeId ? state.get(nodeId) : undefined))
  return useMemo(
    () => (nodeId && nodes ? placementNoticeOf(nodes, nodeId, live) : null),
    [nodes, live, nodeId],
  )
}

/** The node a construction tool is placing: its transient draft. */
export const transientDraftId = (nodes: Readonly<Record<string, AnyNode>>) =>
  Object.values(nodes).find(
    (node) => !!(node.metadata as { isTransient?: boolean } | null)?.isTransient,
  )?.id ?? null

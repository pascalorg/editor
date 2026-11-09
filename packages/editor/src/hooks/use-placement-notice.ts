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
import { useShallow } from 'zustand/react/shallow'
import usePlacementPreview from '../store/use-placement-preview'

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

export function previewPlacementNoticeOf(
  nodes: Readonly<Record<string, AnyNode>>,
  draft: Pick<
    ReturnType<typeof usePlacementPreview.getState>,
    'node' | 'parentNode' | 'contextNodes'
  >,
): PlacementNotice | null {
  if (!draft.node) return null
  const context = {
    ...nodes,
    ...Object.fromEntries(draft.contextNodes.map((node) => [node.id, node])),
    ...(draft.parentNode ? { [draft.parentNode.id]: draft.parentNode } : {}),
    [draft.node.id]: draft.node,
  }
  return placementNoticeOf(context, draft.node.id)
}

/**
 * What the node in hand, or the selected node, says about where it stands, read at its live pose
 * while it is placed or moved. Subscribes to the scene only while a node is given, so an
 * always-mounted caller doesn't re-render on every write.
 */
export function usePlacementNotice(
  nodeId: string | null | undefined,
  preview = false,
): PlacementNotice | null {
  const draft = usePlacementPreview(
    useShallow((state) =>
      preview
        ? { node: state.node, parentNode: state.parentNode, contextNodes: state.contextNodes }
        : null,
    ),
  )
  const nodes = useScene((state) => (nodeId || draft?.node ? state.nodes : null))
  const live = useLiveTransforms((state) => (nodeId ? state.get(nodeId) : undefined))
  return useMemo(() => {
    if (!nodes) return null
    if (nodeId) return placementNoticeOf(nodes, nodeId, live)
    if (!draft?.node) return null
    return previewPlacementNoticeOf(nodes, draft)
  }, [nodes, live, nodeId, draft])
}

/** The node a construction tool is placing: its transient draft. */
export const transientDraftId = (nodes: Readonly<Record<string, AnyNode>>) =>
  Object.values(nodes).find(
    (node) => !!(node.metadata as { isTransient?: boolean } | null)?.isTransient,
  )?.id ?? null

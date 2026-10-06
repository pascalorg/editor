import {
  type AnyNode,
  type AnyNodeId,
  type ItemNode,
  useLiveTransforms,
  useScene,
} from '@pascal-app/core'
import { floorItemWarning } from '@pascal-app/core/building'
import { useMemo } from 'react'

/**
 * Whether a floor item fits where it stands now: in a door's way or too large for its room,
 * by the check place_items refuses with. Read at its live pose while it is placed or moved.
 */
export function useFloorItemWarning(nodeId: string | null | undefined) {
  const nodes = useScene((state) => state.nodes)
  const live = useLiveTransforms((state) => (nodeId ? state.get(nodeId) : undefined))
  return useMemo(() => {
    const node = nodeId ? (nodes[nodeId as AnyNodeId] as AnyNode | undefined) : undefined
    if (node?.type !== 'item') return null
    const posed: ItemNode = live
      ? {
          ...node,
          position: live.position,
          rotation: [node.rotation[0], live.rotation, node.rotation[2]],
        }
      : node
    return floorItemWarning(nodes, posed)
  }, [nodes, live, nodeId])
}

/** The item a raw item tool is placing: its transient draft. */
export const placingItemId = (nodes: Readonly<Record<string, AnyNode>>) =>
  Object.values(nodes).find(
    (node) =>
      node.type === 'item' && !!(node.metadata as { isTransient?: boolean } | null)?.isTransient,
  )?.id ?? null

'use client'

import { type AnyNode, type AnyNodeId, sceneRegistry, useScene } from '@pascal-app/core'
import { useCallback, useRef, useState } from 'react'
import { isFreshPlacementMetadata } from '../../../lib/placement-metadata'
import useEditor from '../../../store/use-editor'

type FreshPlacementNode = Pick<AnyNode, 'id' | 'metadata'>

type FreshPlacementVisibilityArgs = {
  node: FreshPlacementNode
  enabled?: boolean
}

export function useFreshPlacementVisibility({
  node,
  enabled = true,
}: FreshPlacementVisibilityArgs) {
  const isFreshPlacement = enabled && isFreshPlacementMetadata(node.metadata)
  const useAbsoluteCursorPlacement = isFreshPlacement && !useEditor.getState().placementDragMode
  const shouldStartHidden = useAbsoluteCursorPlacement

  const [visibility, setVisibility] = useState(() => ({
    nodeId: node.id,
    visible: !shouldStartHidden,
  }))
  const visibilityRef = useRef(visibility)
  const previewVisible = visibility.nodeId === node.id ? visibility.visible : !shouldStartHidden

  const setPreviewVisibleForNode = useCallback(
    (visible: boolean) => {
      const current = visibilityRef.current
      if (current.nodeId === node.id && current.visible === visible) return
      const next = { nodeId: node.id, visible }
      visibilityRef.current = next
      setVisibility(next)
    },
    [node.id],
  )

  const revealFreshPlacement = useCallback(() => {
    if (!isFreshPlacement) return
    setPreviewVisibleForNode(true)

    sceneRegistry.nodes.get(node.id)?.traverse((child) => {
      child.visible = true
    })

    const liveNode = useScene.getState().nodes[node.id as AnyNodeId]
    if (liveNode?.visible === false) {
      useScene.getState().updateNode(node.id as AnyNodeId, { visible: true } as Partial<AnyNode>)
    }
  }, [isFreshPlacement, node.id, setPreviewVisibleForNode])

  return {
    isFreshPlacement,
    previewVisible,
    revealFreshPlacement,
    useAbsoluteCursorPlacement,
  }
}

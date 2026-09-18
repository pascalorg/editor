'use client'

import { type AnyNodeId, type WallNode, useLiveNodeOverrides, useScene } from '@pascal-app/core'
import { PanelRows, PanelWrapper } from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { useCallback, useMemo } from 'react'
import { wallSettings } from './panel-model'

export default function WallPanel() {
  const selectedId = useViewer((state) => state.selection.selectedIds[0]) as AnyNodeId | undefined
  const sceneNode = useScene((state) => (selectedId ? state.nodes[selectedId] : undefined))
  const nodes = useScene((state) => state.nodes)
  const overrides = useLiveNodeOverrides((state) =>
    selectedId ? state.get(selectedId) : undefined,
  )
  const node = useMemo(
    () => (sceneNode?.type === 'wall' ? ({ ...sceneNode, ...overrides } as WallNode) : undefined),
    [sceneNode, overrides],
  )
  const update = useCallback(
    (patch: Partial<WallNode>) => {
      if (selectedId) useScene.getState().updateNode(selectedId, patch)
    },
    [selectedId],
  )
  if (!node) return null
  return (
    <PanelWrapper
      title={node.name || 'Wall'}
      icon="/icons/wall.webp"
      width={280}
      onClose={() => useViewer.getState().setSelection({ selectedIds: [] })}
    >
      <PanelRows rows={wallSettings(node, nodes, update)} />
    </PanelWrapper>
  )
}

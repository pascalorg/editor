'use client'

import { type AnyNodeId, useScene } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import Image from 'next/image'
import { useCallback, useState } from 'react'
import useEditor from './../../../../../store/use-editor'
import { InlineRenameInput } from './inline-rename-input'
import { focusTreeNode, handleTreeSelection, TreeNodeWrapper } from './tree-node'
import { TreeNodeActions } from './tree-node-actions'

interface DoorTreeNodeProps {
  nodeId: AnyNodeId
  depth: number
  isLast?: boolean
}

export function DoorTreeNode({ nodeId, depth, isLast }: DoorTreeNodeProps) {
  const [isEditing, setIsEditing] = useState(false)
  const isVisible = useScene((s) => s.nodes[nodeId as AnyNodeId]?.visible !== false)
  const isSelected = useViewer((state) => state.selection.selectedIds.includes(nodeId))
  const isHovered = useViewer((state) => state.hoveredId === nodeId)
  const setSelection = useViewer((state) => state.setSelection)
  const setHoveredId = useViewer((state) => state.setHoveredId)

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      const handled = handleTreeSelection(
        e,
        nodeId,
        useViewer.getState().selection.selectedIds,
        setSelection,
      )
      if (!handled && useEditor.getState().phase === 'furnish') {
        useEditor.getState().setPhase('structure')
      }
    },
    [nodeId, setSelection],
  )

  const handleStartEditing = useCallback(() => setIsEditing(true), [])
  const handleStopEditing = useCallback(() => setIsEditing(false), [])

  return (
    <TreeNodeWrapper
      actions={<TreeNodeActions nodeId={nodeId as AnyNodeId} />}
      depth={depth}
      expanded={false}
      hasChildren={false}
      icon={
        <Image alt="" className="object-contain" height={14} src="/icons/door.png" width={14} />
      }
      isHovered={isHovered}
      isLast={isLast}
      isSelected={isSelected}
      isVisible={isVisible}
      label={
        <InlineRenameInput
          defaultName="Door"
          isEditing={isEditing}
          nodeId={nodeId as AnyNodeId}
          onStartEditing={handleStartEditing}
          onStopEditing={handleStopEditing}
        />
      }
      nodeId={nodeId}
      onClick={handleClick}
      onDoubleClick={() => focusTreeNode(nodeId as AnyNodeId)}
      onMouseEnter={() => setHoveredId(nodeId)}
      onMouseLeave={() => setHoveredId(null)}
      onToggle={() => {}}
    />
  )
}

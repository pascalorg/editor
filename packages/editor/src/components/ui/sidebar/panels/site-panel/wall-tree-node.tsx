import { type AnyNodeId, useScene, type WallNode } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import Image from 'next/image'
import { memo, useCallback, useEffect, useRef, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import useEditor from './../../../../../store/use-editor'
import { InlineRenameInput } from './inline-rename-input'
import { focusTreeNode, handleTreeSelection, TreeNode, TreeNodeWrapper } from './tree-node'
import { TreeNodeActions } from './tree-node-actions'

interface WallTreeNodeProps {
  nodeId: AnyNodeId
  depth: number
  isLast?: boolean
}

export const WallTreeNode = memo(function WallTreeNode({
  nodeId,
  depth,
  isLast,
}: WallTreeNodeProps) {
  const [expanded, setExpanded] = useState(false)
  const [isEditing, setIsEditing] = useState(false)
  const isVisible = useScene((s) => s.nodes[nodeId as AnyNodeId]?.visible !== false)
  const children = useScene(
    useShallow((s) => (s.nodes[nodeId as AnyNodeId] as WallNode | undefined)?.children ?? []),
  )
  const isSelected = useViewer((state) => state.selection.selectedIds.includes(nodeId))
  const isHovered = useViewer((state) => state.hoveredId === nodeId)
  const setSelection = useViewer((state) => state.setSelection)
  const setHoveredId = useViewer((state) => state.setHoveredId)

  // Expand when a descendant is selected — imperative to avoid subscribing to the full selectedIds array
  useEffect(() => {
    return useViewer.subscribe((state) => {
      const { selectedIds } = state.selection
      if (selectedIds.length === 0) return
      const nodes = useScene.getState().nodes
      for (const id of selectedIds) {
        let current = nodes[id as AnyNodeId]
        while (current?.parentId) {
          if (current.parentId === nodeId) {
            setExpanded(true)
            return
          }
          current = nodes[current.parentId as AnyNodeId]
        }
      }
    })
  }, [nodeId])

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

  const handleDoubleClick = useCallback(() => focusTreeNode(nodeId as AnyNodeId), [nodeId])
  const handleMouseEnter = useCallback(() => setHoveredId(nodeId), [nodeId, setHoveredId])
  const handleMouseLeave = useCallback(() => setHoveredId(null), [setHoveredId])
  const handleToggle = useCallback(() => setExpanded((prev) => !prev), [])
  const handleStartEditing = useCallback(() => setIsEditing(true), [])
  const handleStopEditing = useCallback(() => setIsEditing(false), [])

  return (
    <TreeNodeWrapper
      actions={<TreeNodeActions nodeId={nodeId as AnyNodeId} />}
      depth={depth}
      expanded={expanded}
      hasChildren={children.length > 0}
      icon={
        <Image alt="" className="object-contain" height={14} src="/icons/wall.png" width={14} />
      }
      isHovered={isHovered}
      isLast={isLast}
      isSelected={isSelected}
      isVisible={isVisible}
      label={
        <InlineRenameInput
          defaultName="Wall"
          isEditing={isEditing}
          nodeId={nodeId as AnyNodeId}
          onStartEditing={handleStartEditing}
          onStopEditing={handleStopEditing}
        />
      }
      nodeId={nodeId}
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onToggle={handleToggle}
    >
      {children.map((childId, index) => (
        <TreeNode
          depth={depth + 1}
          isLast={index === children.length - 1}
          key={childId}
          nodeId={childId}
        />
      ))}
    </TreeNodeWrapper>
  )
})

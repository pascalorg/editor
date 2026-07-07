'use client'

import {
  type AnyNodeId,
  type CabinetModuleNode,
  type CabinetNode,
  useScene,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import Image from 'next/image'
import { memo, useCallback, useEffect, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { InlineRenameInput } from './inline-rename-input'
import {
  focusTreeNode,
  handleTreeSelection,
  routeTreeSelectionToNode,
  TreeNode,
  TreeNodeWrapper,
} from './tree-node'
import { TreeNodeActions } from './tree-node-actions'
import { resolveTreeChildIds, treeContainsDescendant } from './tree-structure'

interface CabinetTreeNodeProps {
  nodeId: AnyNodeId
  depth: number
  isLast?: boolean
}

export const CabinetTreeNode = memo(function CabinetTreeNode({
  nodeId,
  depth,
  isLast,
}: CabinetTreeNodeProps) {
  const [isEditing, setIsEditing] = useState(false)
  const [expanded, setExpanded] = useState(true)
  const isVisible = useScene((s) => s.nodes[nodeId]?.visible !== false)
  const children = useScene(useShallow((s) => resolveTreeChildIds(nodeId, s.nodes)))
  const node = useScene((s) => s.nodes[nodeId] as CabinetNode | CabinetModuleNode | undefined)
  const isSelected = useViewer((state) => state.selection.selectedIds.includes(nodeId))
  const isHovered = useViewer((state) => state.hoveredId === nodeId)
  const setSelection = useViewer((state) => state.setSelection)
  const setHoveredId = useViewer((state) => state.setHoveredId)

  useEffect(() => {
    return useViewer.subscribe((state) => {
      const { selectedIds } = state.selection
      if (selectedIds.length === 0) return
      const nodes = useScene.getState().nodes
      for (const id of selectedIds) {
        if (treeContainsDescendant(nodeId, id as AnyNodeId, nodes)) {
          setExpanded(true)
          return
        }
      }
    })
  }, [nodeId])

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      handleTreeSelection(e, nodeId, useViewer.getState().selection.selectedIds, setSelection)
      routeTreeSelectionToNode(node)
    },
    [node, nodeId, setSelection],
  )

  const handleDoubleClick = useCallback(() => focusTreeNode(nodeId), [nodeId])
  const handleMouseEnter = useCallback(() => setHoveredId(nodeId), [nodeId, setHoveredId])
  const handleMouseLeave = useCallback(() => setHoveredId(null), [setHoveredId])
  const handleToggle = useCallback(() => setExpanded((prev) => !prev), [])
  const handleStartEditing = useCallback(() => setIsEditing(true), [])
  const handleStopEditing = useCallback(() => setIsEditing(false), [])

  const hasChildren = children.length > 0
  const defaultName =
    node?.name ||
    (node?.type === 'cabinet'
      ? `Modular Cabinet (${children.length} module${children.length === 1 ? '' : 's'})`
      : 'Cabinet Module')

  return (
    <TreeNodeWrapper
      actions={<TreeNodeActions nodeId={nodeId} />}
      depth={depth}
      expanded={expanded}
      hasChildren={hasChildren}
      icon={<Image alt="" className="object-contain" height={14} src="/icons/furniture.webp" width={14} />}
      isHovered={isHovered}
      isLast={isLast}
      isSelected={isSelected}
      isVisible={isVisible}
      label={
        <InlineRenameInput
          defaultName={defaultName}
          isEditing={isEditing}
          nodeId={nodeId}
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
      {hasChildren &&
        children.map((childId, index) => (
          <TreeNode
            depth={depth + 1}
            isLast={index === children.length - 1}
            key={childId}
            nodeId={childId as AnyNodeId}
          />
        ))}
    </TreeNodeWrapper>
  )
})

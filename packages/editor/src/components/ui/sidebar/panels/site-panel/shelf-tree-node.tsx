'use client'

import { type AnyNodeId, type ShelfNode, useScene } from '@pascal-app/core'
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

interface ShelfTreeNodeProps {
  nodeId: ShelfNode['id']
  depth: number
  isLast?: boolean
}

/**
 * Sidebar tree entry for shelf. Mirrors `item-tree-node`'s shape so the
 * shelf's hosted items list as collapsible children — same pattern items
 * use for their nested items. The shelf has its own `children: ItemNode[`id`]`
 * field on the schema; items reparent into it via `def.surfaces` + the
 * placement coordinator's shelf strategy.
 */
export const ShelfTreeNode = memo(function ShelfTreeNode({
  nodeId,
  depth,
  isLast,
}: ShelfTreeNodeProps) {
  const [isEditing, setIsEditing] = useState(false)
  const [expanded, setExpanded] = useState(true)
  const isVisible = useScene((s) => s.nodes[nodeId]?.visible !== false)
  const children = useScene(
    useShallow((s) => (s.nodes[nodeId] as ShelfNode | undefined)?.children ?? []),
  )
  const node = useScene((s) => s.nodes[nodeId] as ShelfNode | undefined)
  const isSelected = useViewer((state) => state.selection.selectedIds.includes(nodeId))
  const isHovered = useViewer((state) => state.hoveredId === nodeId)
  const setSelection = useViewer((state) => state.setSelection)
  const setHoveredId = useViewer((state) => state.setHoveredId)

  // Expand when a descendant is selected — same imperative subscription
  // the item tree-node uses, so we don't re-render when unrelated
  // selection-state ticks.
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
      handleTreeSelection(
        e,
        nodeId,
        useViewer.getState().selection.selectedIds,
        setSelection,
      )
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

  return (
    <TreeNodeWrapper
      actions={<TreeNodeActions nodeId={nodeId} />}
      depth={depth}
      expanded={expanded}
      hasChildren={hasChildren}
      icon={
        <Image alt="" className="object-contain" height={14} src="/icons/shelf.webp" width={14} />
      }
      isHovered={isHovered}
      isLast={isLast}
      isSelected={isSelected}
      isVisible={isVisible}
      label={
        <InlineRenameInput
          defaultName="Shelf"
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
            nodeId={childId}
          />
        ))}
    </TreeNodeWrapper>
  )
})

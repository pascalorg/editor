import { type AnyNodeId, type ItemNode, useScene } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import Image from 'next/image'
import { memo, useCallback, useEffect, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { resolveNodeSnapTarget, SnapTargetIcon } from '../../../snap-target-badge'
import { InlineRenameInput } from './inline-rename-input'
import {
  focusTreeNode,
  handleTreeSelection,
  routeTreeSelectionToNode,
  TreeNode,
  TreeNodeWrapper,
} from './tree-node'
import { TreeNodeActions } from './tree-node-actions'

const CATEGORY_ICONS: Record<string, string> = {
  door: '/icons/door.webp',
  window: '/icons/window.webp',
  furniture: '/icons/couch.webp',
  appliance: '/icons/appliance.webp',
  kitchen: '/icons/kitchen.webp',
  bathroom: '/icons/bathroom.webp',
  outdoor: '/icons/tree.webp',
}

interface ItemTreeNodeProps {
  nodeId: AnyNodeId
  depth: number
  isLast?: boolean
}

export const ItemTreeNode = memo(function ItemTreeNode({
  nodeId,
  depth,
  isLast,
}: ItemTreeNodeProps) {
  const [isEditing, setIsEditing] = useState(false)
  const [expanded, setExpanded] = useState(true)
  const isVisible = useScene((s) => s.nodes[nodeId]?.visible !== false)
  const children = useScene(
    useShallow((s) => (s.nodes[nodeId] as ItemNode | undefined)?.children ?? []),
  )
  const node = useScene((s) => s.nodes[nodeId] as ItemNode | undefined)
  const asset = node?.asset
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

  const iconSrc = CATEGORY_ICONS[asset?.category ?? ''] || '/icons/couch.webp'
  const snapTarget = resolveNodeSnapTarget(node)
  const defaultName = asset?.name || 'Item'
  const hasChildren = children.length > 0

  return (
    <TreeNodeWrapper
      actions={<TreeNodeActions nodeId={nodeId} />}
      depth={depth}
      expanded={expanded}
      hasChildren={hasChildren}
      icon={
        snapTarget ? (
          <SnapTargetIcon target={snapTarget}>
            <Image alt="" className="object-contain" height={14} src={iconSrc} width={14} />
          </SnapTargetIcon>
        ) : (
          <Image alt="" className="object-contain" height={14} src={iconSrc} width={14} />
        )
      }
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
            nodeId={childId}
          />
        ))}
    </TreeNodeWrapper>
  )
})

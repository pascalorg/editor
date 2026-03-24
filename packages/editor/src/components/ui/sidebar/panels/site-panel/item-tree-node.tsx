import { type AnyNodeId, type ItemNode, useScene } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import Image from 'next/image'
import { useEffect, useState } from 'react'
import useEditor from './../../../../../store/use-editor'
import { InlineRenameInput } from './inline-rename-input'
import { focusTreeNode, handleTreeSelection, TreeNode, TreeNodeWrapper } from './tree-node'
import { TreeNodeActions } from './tree-node-actions'

const CATEGORY_ICONS: Record<string, string> = {
  door: '/icons/door.png',
  window: '/icons/window.png',
  furniture: '/icons/couch.png',
  appliance: '/icons/appliance.png',
  kitchen: '/icons/kitchen.png',
  bathroom: '/icons/bathroom.png',
  outdoor: '/icons/tree.png',
}

interface ItemTreeNodeProps {
  node: ItemNode
  depth: number
  isLast?: boolean
}

export function ItemTreeNode({ node, depth, isLast }: ItemTreeNodeProps) {
  const [isEditing, setIsEditing] = useState(false)
  const [expanded, setExpanded] = useState(true)
  const iconSrc = CATEGORY_ICONS[node.asset.category] || '/icons/couch.png'
  const selectedIds = useViewer((state) => state.selection.selectedIds)
  const isSelected = selectedIds.includes(node.id)
  const isHovered = useViewer((state) => state.hoveredId === node.id)
  const setSelection = useViewer((state) => state.setSelection)
  const setHoveredId = useViewer((state) => state.setHoveredId)

  useEffect(() => {
    if (selectedIds.length === 0) return
    const nodes = useScene.getState().nodes
    let isDescendant = false
    for (const id of selectedIds) {
      let current = nodes[id as AnyNodeId]
      while (current?.parentId) {
        if (current.parentId === node.id) {
          isDescendant = true
          break
        }
        current = nodes[current.parentId as AnyNodeId]
      }
      if (isDescendant) break
    }
    if (isDescendant) {
      setExpanded(true)
    }
  }, [selectedIds, node.id])

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    const handled = handleTreeSelection(e, node.id, selectedIds, setSelection)
    if (!handled && useEditor.getState().phase === 'structure') {
      useEditor.getState().setPhase('furnish')
    }
  }

  const handleDoubleClick = () => {
    focusTreeNode(node.id)
  }

  const handleMouseEnter = () => {
    setHoveredId(node.id)
  }

  const handleMouseLeave = () => {
    setHoveredId(null)
  }

  const defaultName = node.asset.name || 'Item'
  const hasChildren = node.children && node.children.length > 0

  return (
    <TreeNodeWrapper
      actions={<TreeNodeActions node={node} />}
      depth={depth}
      expanded={expanded}
      hasChildren={hasChildren}
      icon={<Image alt="" className="object-contain" height={14} src={iconSrc} width={14} />}
      isHovered={isHovered}
      isLast={isLast}
      isSelected={isSelected}
      isVisible={node.visible !== false}
      label={
        <InlineRenameInput
          defaultName={defaultName}
          isEditing={isEditing}
          node={node}
          onStartEditing={() => setIsEditing(true)}
          onStopEditing={() => setIsEditing(false)}
        />
      }
      nodeId={node.id}
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onToggle={() => setExpanded(!expanded)}
    >
      {hasChildren &&
        node.children.map((childId, index) => (
          <TreeNode
            depth={depth + 1}
            isLast={index === node.children.length - 1}
            key={childId}
            nodeId={childId}
          />
        ))}
    </TreeNodeWrapper>
  )
}

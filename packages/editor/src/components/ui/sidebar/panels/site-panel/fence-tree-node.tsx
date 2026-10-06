import { type AnyNodeId, type FenceNode, useScene } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import Image from 'next/image'
import { memo, useEffect, useState } from 'react'
import useEditor from '../../../../../store/use-editor'
import { InlineRenameInput } from './inline-rename-input'
import { focusTreeNode, handleTreeSelection, TreeNode, TreeNodeWrapper } from './tree-node'
import { TreeNodeActions } from './tree-node-actions'

interface FenceTreeNodeProps {
  nodeId: AnyNodeId
  depth: number
  isLast?: boolean
}

export const FenceTreeNode = memo(function FenceTreeNode({
  nodeId,
  depth,
  isLast,
}: FenceTreeNodeProps) {
  const node = useScene((state) => state.nodes[nodeId]) as FenceNode | undefined
  const [isEditing, setIsEditing] = useState(false)
  const [expanded, setExpanded] = useState(true)
  const selectedIds = useViewer((state) => state.selection.selectedIds)
  const isSelected = selectedIds.includes(nodeId)
  const isHovered = useViewer((state) => state.hoveredId === nodeId)
  const setSelection = useViewer((state) => state.setSelection)
  const setHoveredId = useViewer((state) => state.setHoveredId)

  const children = node?.children ?? []
  const hasSelectedChild = children.some((id) => selectedIds.includes(id))

  useEffect(() => {
    if (hasSelectedChild) setExpanded(true)
  }, [hasSelectedChild, node?.children])

  if (!node) return null

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    const handled = handleTreeSelection(e, nodeId, selectedIds, setSelection)
    if (!handled && useEditor.getState().phase === 'furnish') {
      useEditor.getState().setPhase('structure')
    }
  }

  return (
    <TreeNodeWrapper
      actions={<TreeNodeActions nodeId={node.id} />}
      depth={depth}
      expanded={expanded}
      hasChildren={children.length > 0}
      icon={
        <Image alt="" className="object-contain" height={14} src="/icons/fence.webp" width={14} />
      }
      isHovered={isHovered}
      isLast={isLast}
      isSelected={isSelected}
      isVisible={node.visible !== false}
      label={
        <InlineRenameInput
          defaultName="Fence"
          isEditing={isEditing}
          nodeId={node.id}
          onStartEditing={() => setIsEditing(true)}
          onStopEditing={() => setIsEditing(false)}
        />
      }
      nodeId={nodeId}
      onClick={handleClick}
      onDoubleClick={() => focusTreeNode(nodeId)}
      onMouseEnter={() => setHoveredId(nodeId)}
      onMouseLeave={() => setHoveredId(null)}
      onToggle={() => setExpanded((value) => !value)}
    >
      {children.map((childId, index) => (
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

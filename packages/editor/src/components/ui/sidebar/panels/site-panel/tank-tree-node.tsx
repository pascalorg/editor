import { type AnyNodeId, type TankNode, useScene } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import Image from 'next/image'
import { memo, useState } from 'react'
import useEditor from '../../../../../store/use-editor'
import { InlineRenameInput } from './inline-rename-input'
import { focusTreeNode, handleTreeSelection, TreeNodeWrapper } from './tree-node'
import { TreeNodeActions } from './tree-node-actions'

interface TankTreeNodeProps {
  nodeId: AnyNodeId
  depth: number
  isLast?: boolean
}

export const TankTreeNode = memo(function TankTreeNode({
  nodeId,
  depth,
  isLast,
}: TankTreeNodeProps) {
  const node = useScene((state) => state.nodes[nodeId]) as TankNode | undefined
  const [isEditing, setIsEditing] = useState(false)
  const selectedIds = useViewer((state) => state.selection.selectedIds)
  const isSelected = selectedIds.includes(nodeId)
  const isHovered = useViewer((state) => state.hoveredId === nodeId)
  const setSelection = useViewer((state) => state.setSelection)
  const setHoveredId = useViewer((state) => state.setHoveredId)

  if (!node) return null

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    const handled = handleTreeSelection(e, nodeId, selectedIds, setSelection)
    if (!handled) {
      useEditor.getState().setPhase('structure')
      useEditor.getState().setStructureLayer('industrial')
    }
  }

  return (
    <TreeNodeWrapper
      actions={<TreeNodeActions nodeId={node.id} />}
      depth={depth}
      expanded={false}
      hasChildren={false}
      icon={<Image alt="" className="object-contain" height={14} src="/icons/tank.svg" width={14} />}
      isHovered={isHovered}
      isLast={isLast}
      isSelected={isSelected}
      isVisible={node.visible !== false}
      label={
        <InlineRenameInput
          defaultName="Tank"
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
      onToggle={() => {}}
    />
  )
})


import { type AnyNodeId, type ElevatorNode, useScene } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import Image from 'next/image'
import { memo, useCallback, useState } from 'react'
import useEditor from './../../../../../store/use-editor'
import { InlineRenameInput } from './inline-rename-input'
import { focusTreeNode, handleTreeSelection, TreeNodeWrapper } from './tree-node'
import { TreeNodeActions } from './tree-node-actions'

interface ElevatorTreeNodeProps {
  nodeId: AnyNodeId
  depth: number
  isLast?: boolean
}

export const ElevatorTreeNode = memo(function ElevatorTreeNode({
  nodeId,
  depth,
  isLast,
}: ElevatorTreeNodeProps) {
  const [isEditing, setIsEditing] = useState(false)
  const isVisible = useScene((s) => s.nodes[nodeId]?.visible !== false)
  const node = useScene((s) => s.nodes[nodeId] as ElevatorNode | undefined)
  const isSelected = useViewer((state) => state.selection.selectedIds.includes(nodeId))
  const isHovered = useViewer((state) => state.hoveredId === nodeId)
  const setSelection = useViewer((state) => state.setSelection)
  const setHoveredId = useViewer((state) => state.setHoveredId)

  const handleClick = useCallback(
    (event: React.MouseEvent) => {
      event.stopPropagation()
      const handled = handleTreeSelection(
        event,
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

  return (
    <TreeNodeWrapper
      actions={<TreeNodeActions nodeId={nodeId} />}
      depth={depth}
      expanded={false}
      hasChildren={false}
      icon={
        <Image alt="" className="object-contain" height={14} src="/icons/elevator.webp" width={14} />
      }
      isHovered={isHovered}
      isLast={isLast}
      isSelected={isSelected}
      isVisible={isVisible}
      label={
        <InlineRenameInput
          defaultName={node?.name || 'Elevator'}
          isEditing={isEditing}
          nodeId={nodeId}
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

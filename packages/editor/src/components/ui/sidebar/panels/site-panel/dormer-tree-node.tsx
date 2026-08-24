import { type AnyNodeId, type DormerNode, useScene } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import Image from 'next/image'
import { memo, useCallback, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { SnapTargetIcon } from '../../../snap-target-badge'
import useEditor from './../../../../../store/use-editor'
import { InlineRenameInput } from './inline-rename-input'
import { focusTreeNode, handleTreeSelection, TreeNode, TreeNodeWrapper } from './tree-node'
import { TreeNodeActions } from './tree-node-actions'

interface DormerTreeNodeProps {
  nodeId: AnyNodeId
  depth: number
  isLast?: boolean
}

/**
 * Sidebar tree-node entry for a dormer. Mirrors `ChimneyTreeNode`
 * exactly — dormers are leaf entries (no children) parented under
 * their host roof segment. The `roof.png` icon matches the rest of
 * the roof-accessory kinds.
 */
export const DormerTreeNode = memo(function DormerTreeNode({
  nodeId,
  depth,
  isLast,
}: DormerTreeNodeProps) {
  const [isEditing, setIsEditing] = useState(false)
  const [expanded, setExpanded] = useState(true)
  const isVisible = useScene((s) => s.nodes[nodeId]?.visible !== false)
  const node = useScene((s) => s.nodes[nodeId] as DormerNode | undefined)
  const children = useScene(
    useShallow((s) => (s.nodes[nodeId] as DormerNode | undefined)?.children ?? []),
  )
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

  const defaultName = node?.name || 'Dormer'

  return (
    <TreeNodeWrapper
      actions={<TreeNodeActions nodeId={nodeId} />}
      depth={depth}
      expanded={expanded}
      hasChildren={children.length > 0}
      icon={
        <SnapTargetIcon target="roof">
          <Image
            alt=""
            className="object-contain opacity-60"
            height={14}
            src="/icons/roof.webp"
            width={14}
          />
        </SnapTargetIcon>
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

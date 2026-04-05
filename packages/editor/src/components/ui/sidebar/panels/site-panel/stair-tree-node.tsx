import { type AnyNodeId, type StairNode, type StairSegmentNode, useScene } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { AnimatePresence } from 'motion/react'
import Image from 'next/image'
import { useCallback, useEffect, useState } from 'react'
import useEditor from '../../../../../store/use-editor'
import { InlineRenameInput } from './inline-rename-input'
import { focusTreeNode, handleTreeSelection, TreeNodeWrapper } from './tree-node'
import { TreeNodeActions } from './tree-node-actions'
import { DropIndicatorLine, useTreeNodeDrag } from './tree-node-drag'

interface StairTreeNodeProps {
  node: StairNode
  depth: number
  isLast?: boolean
}

export function StairTreeNode({ node, depth, isLast }: StairTreeNodeProps) {
  const [isEditing, setIsEditing] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const selectedIds = useViewer((state) => state.selection.selectedIds)
  const isSelected = selectedIds.includes(node.id)
  const isHovered = useViewer((state) => state.hoveredId === node.id)
  const setSelection = useViewer((state) => state.setSelection)
  const setHoveredId = useViewer((state) => state.setHoveredId)
  const nodes = useScene((state) => state.nodes)
  const { drag, dropTarget } = useTreeNodeDrag()

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    const handled = handleTreeSelection(e, node.id, selectedIds, setSelection)
    if (!handled && useEditor.getState().phase === 'furnish') {
      useEditor.getState().setPhase('structure')
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

  const segments = (node.children ?? [])
    .map((childId) => nodes[childId as AnyNodeId] as StairSegmentNode | undefined)
    .filter((n): n is StairSegmentNode => n?.type === 'stair-segment')

  const hasSelectedChild = segments.some((seg) => selectedIds.includes(seg.id))

  useEffect(() => {
    if (isSelected || hasSelectedChild) {
      setExpanded(true)
    }
  }, [isSelected, hasSelectedChild])

  // Auto-expand when a segment is being dragged over this stair
  const isDropTarget = drag !== null && dropTarget?.parentId === node.id
  useEffect(() => {
    if (isDropTarget && !expanded) {
      setExpanded(true)
    }
  }, [isDropTarget, expanded])

  const segmentCount = segments.length
  const defaultName = `Staircase (${segmentCount} segment${segmentCount !== 1 ? 's' : ''})`

  // Hide the dragged segment from every stair while dragging
  const visibleSegments = drag ? segments.filter((seg) => seg.id !== drag.nodeId) : segments

  const isValidDropTarget = drag !== null && drag.nodeId !== node.id

  return (
    <div data-drop-target={node.id}>
      <TreeNodeWrapper
        actions={<TreeNodeActions node={node} />}
        depth={depth}
        expanded={expanded}
        hasChildren={segments.length > 0}
        icon={
          <Image alt="" className="object-contain" height={14} src="/icons/stairs.png" width={14} />
        }
        isDropTarget={isValidDropTarget && isDropTarget}
        isHovered={isHovered || isDropTarget}
        isLast={isLast && !expanded}
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
        {visibleSegments.map((seg, i) => {
          const showIndicatorBefore = isDropTarget && dropTarget?.insertIndex === i
          const showIndicatorAfter =
            isDropTarget &&
            i === visibleSegments.length - 1 &&
            dropTarget?.insertIndex !== undefined &&
            dropTarget.insertIndex > i

          return (
            <div key={seg.id}>
              <AnimatePresence>
                {showIndicatorBefore && <DropIndicatorLine key="indicator-before" />}
              </AnimatePresence>
              <StairSegmentTreeNode
                depth={depth + 1}
                isLast={isLast && i === visibleSegments.length - 1 && !showIndicatorAfter}
                node={seg}
              />
              <AnimatePresence>
                {showIndicatorAfter && <DropIndicatorLine key="indicator-after" />}
              </AnimatePresence>
            </div>
          )
        })}
        <AnimatePresence>
          {isDropTarget && visibleSegments.length === 0 && <DropIndicatorLine />}
        </AnimatePresence>
      </TreeNodeWrapper>
    </div>
  )
}

function StairSegmentTreeNode({
  node,
  depth,
  isLast,
}: {
  node: StairSegmentNode
  depth: number
  isLast?: boolean
}) {
  const [isEditing, setIsEditing] = useState(false)
  const selectedIds = useViewer((state) => state.selection.selectedIds)
  const isSelected = selectedIds.includes(node.id)
  const isHovered = useViewer((state) => state.hoveredId === node.id)
  const setSelection = useViewer((state) => state.setSelection)
  const setHoveredId = useViewer((state) => state.setHoveredId)
  const { startDrag, isDragging } = useTreeNodeDrag()

  const handleClick = (e: React.MouseEvent) => {
    if (isDragging) return
    e.stopPropagation()
    handleTreeSelection(e, node.id, selectedIds, setSelection)
  }

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (e.button !== 0) return
      const typeLabel = node.segmentType === 'stair' ? 'Flight' : 'Landing'
      const label = `${typeLabel} (${node.width.toFixed(1)}×${node.length.toFixed(1)}m)`
      startDrag(node.id, node.type, node.parentId as string, label, e.clientX, e.clientY)
    },
    [node.id, node.type, node.parentId, node.segmentType, node.width, node.length, startDrag],
  )

  const typeLabel = node.segmentType === 'stair' ? 'Flight' : 'Landing'
  const defaultName = `${typeLabel} (${node.width.toFixed(1)}×${node.length.toFixed(1)}m)`

  return (
    <div data-drop-child={node.id}>
      <TreeNodeWrapper
        actions={<TreeNodeActions node={node} />}
        depth={depth}
        expanded={false}
        hasChildren={false}
        icon={
          <Image
            alt=""
            className="object-contain opacity-60"
            height={14}
            src="/icons/stairs.png"
            width={14}
          />
        }
        isDraggable
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
        onDoubleClick={() => focusTreeNode(node.id)}
        onMouseEnter={() => setHoveredId(node.id)}
        onMouseLeave={() => setHoveredId(null)}
        onPointerDown={handlePointerDown}
        onToggle={() => {}}
      />
    </div>
  )
}

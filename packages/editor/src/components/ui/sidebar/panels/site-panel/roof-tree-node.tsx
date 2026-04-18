import { type AnyNodeId, type RoofNode, type RoofSegmentNode, useScene } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { AnimatePresence } from 'motion/react'
import Image from 'next/image'
import { memo, useCallback, useEffect, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import useEditor from '../../../../../store/use-editor'
import { InlineRenameInput } from './inline-rename-input'
import { focusTreeNode, handleTreeSelection, TreeNodeWrapper } from './tree-node'
import { TreeNodeActions } from './tree-node-actions'
import { DropIndicatorLine, useTreeNodeDrag } from './tree-node-drag'

interface RoofTreeNodeProps {
  nodeId: AnyNodeId
  depth: number
  isLast?: boolean
}

export const RoofTreeNode = memo(function RoofTreeNode({
  nodeId,
  depth,
  isLast,
}: RoofTreeNodeProps) {
  const [isEditing, setIsEditing] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const isVisible = useScene((s) => s.nodes[nodeId]?.visible !== false)
  const isSelected = useViewer((state) => state.selection.selectedIds.includes(nodeId))
  const isHovered = useViewer((state) => state.hoveredId === nodeId)
  const setSelection = useViewer((state) => state.setSelection)
  const setHoveredId = useViewer((state) => state.setHoveredId)
  const { drag, dropTarget } = useTreeNodeDrag()

  const segments = useScene(
    useShallow((s) => {
      const n = s.nodes[nodeId] as RoofNode | undefined
      if (!n) return [] as RoofSegmentNode[]
      return (n.children ?? [])
        .map((childId) => s.nodes[childId as AnyNodeId] as RoofSegmentNode | undefined)
        .filter((n): n is RoofSegmentNode => n?.type === 'roof-segment')
    }),
  )

  // Targeted selector — only re-renders when a segment of THIS roof is selected/deselected
  const hasSelectedChild = useViewer((state) =>
    segments.some((seg) => state.selection.selectedIds.includes(seg.id)),
  )

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

  const handleDoubleClick = useCallback(() => focusTreeNode(nodeId), [nodeId])
  const handleMouseEnter = useCallback(() => setHoveredId(nodeId), [nodeId, setHoveredId])
  const handleMouseLeave = useCallback(() => setHoveredId(null), [setHoveredId])
  const handleToggle = useCallback(() => setExpanded((prev) => !prev), [])
  const handleStartEditing = useCallback(() => setIsEditing(true), [])
  const handleStopEditing = useCallback(() => setIsEditing(false), [])

  useEffect(() => {
    if (isSelected || hasSelectedChild) {
      setExpanded(true)
    }
  }, [isSelected, hasSelectedChild])

  // Auto-expand when a segment is being dragged over this roof
  const isDropTarget = drag !== null && dropTarget?.parentId === nodeId
  useEffect(() => {
    if (isDropTarget && !expanded) {
      setExpanded(true)
    }
  }, [isDropTarget, expanded])

  const segmentCount = segments.length
  const defaultName = `Roof (${segmentCount} segment${segmentCount !== 1 ? 's' : ''})`

  // Hide the dragged segment from every roof while dragging
  const visibleSegments = drag ? segments.filter((seg) => seg.id !== drag.nodeId) : segments

  const isValidDropTarget = drag !== null && drag.nodeId !== nodeId

  return (
    <div data-drop-target={nodeId}>
      <TreeNodeWrapper
        actions={<TreeNodeActions nodeId={nodeId} />}
        depth={depth}
        expanded={expanded}
        hasChildren={segments.length > 0}
        icon={
          <Image alt="" className="object-contain" height={14} src="/icons/roof.png" width={14} />
        }
        isDropTarget={isValidDropTarget && isDropTarget}
        isHovered={isHovered || isDropTarget}
        isLast={isLast && !expanded}
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
              <RoofSegmentTreeNode
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
})

function RoofSegmentTreeNode({
  node,
  depth,
  isLast,
}: {
  node: RoofSegmentNode
  depth: number
  isLast?: boolean
}) {
  const [isEditing, setIsEditing] = useState(false)
  const isSelected = useViewer((state) => state.selection.selectedIds.includes(node.id))
  const isHovered = useViewer((state) => state.hoveredId === node.id)
  const setSelection = useViewer((state) => state.setSelection)
  const setHoveredId = useViewer((state) => state.setHoveredId)
  const { startDrag, isDragging } = useTreeNodeDrag()

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      if (isDragging) return
      e.stopPropagation()
      handleTreeSelection(e, node.id, useViewer.getState().selection.selectedIds, setSelection)
    },
    [node.id, isDragging, setSelection],
  )

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (e.button !== 0) return
      const label = `${node.roofType.charAt(0).toUpperCase() + node.roofType.slice(1)} (${node.width.toFixed(1)}×${node.depth.toFixed(1)}m)`
      startDrag(node.id, node.type, node.parentId as string, label, e.clientX, e.clientY)
    },
    [node.id, node.type, node.parentId, node.roofType, node.width, node.depth, startDrag],
  )

  const handleStartEditing = useCallback(() => setIsEditing(true), [])
  const handleStopEditing = useCallback(() => setIsEditing(false), [])

  const defaultName = `${node.roofType.charAt(0).toUpperCase() + node.roofType.slice(1)} (${node.width.toFixed(1)}x${node.depth.toFixed(1)}m)`

  return (
    <div data-drop-child={node.id}>
      <TreeNodeWrapper
        actions={<TreeNodeActions nodeId={node.id} />}
        depth={depth}
        expanded={false}
        hasChildren={false}
        icon={
          <Image
            alt=""
            className="object-contain opacity-60"
            height={14}
            src="/icons/roof.png"
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
            nodeId={node.id}
            onStartEditing={handleStartEditing}
            onStopEditing={handleStopEditing}
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

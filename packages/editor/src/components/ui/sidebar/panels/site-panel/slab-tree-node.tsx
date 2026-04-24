import { type AnyNodeId, type SlabNode, useScene } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import Image from 'next/image'
import { memo, useCallback, useState } from 'react'
import useEditor from './../../../../../store/use-editor'
import { InlineRenameInput } from './inline-rename-input'
import { focusTreeNode, handleTreeSelection, TreeNodeWrapper } from './tree-node'
import { TreeNodeActions } from './tree-node-actions'

interface SlabTreeNodeProps {
  nodeId: AnyNodeId
  depth: number
  isLast?: boolean
}

export const SlabTreeNode = memo(function SlabTreeNode({
  nodeId,
  depth,
  isLast,
}: SlabTreeNodeProps) {
  const [isEditing, setIsEditing] = useState(false)
  const isVisible = useScene((s) => s.nodes[nodeId]?.visible !== false)
  const polygon = useScene((s) => (s.nodes[nodeId] as SlabNode | undefined)?.polygon ?? [])
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

  const handleStartEditing = useCallback(() => setIsEditing(true), [])
  const handleStopEditing = useCallback(() => setIsEditing(false), [])

  const area = calculatePolygonArea(polygon).toFixed(1)
  const defaultName = `Slab (${area}m²)`

  return (
    <TreeNodeWrapper
      actions={<TreeNodeActions nodeId={nodeId} />}
      depth={depth}
      expanded={false}
      hasChildren={false}
      icon={
        <Image alt="" className="object-contain" height={14} src="/icons/floor.png" width={14} />
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
      onDoubleClick={() => focusTreeNode(nodeId)}
      onMouseEnter={() => setHoveredId(nodeId)}
      onMouseLeave={() => setHoveredId(null)}
      onToggle={() => {}}
    />
  )
})

/**
 * Calculate the area of a polygon using the shoelace formula
 */
function calculatePolygonArea(polygon: Array<[number, number]>): number {
  if (polygon.length < 3) return 0

  let area = 0
  const n = polygon.length

  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    const pi = polygon[i]
    const pj = polygon[j]
    if (pi && pj) {
      area += pi[0] * pj[1]
      area -= pj[0] * pi[1]
    }
  }

  return Math.abs(area) / 2
}

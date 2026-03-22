import { type AnyNodeId, type CeilingNode, useScene } from '@vesper/core'
import { useViewer } from '@vesper/viewer'
import Image from 'next/image'
import { useEffect, useState } from 'react'
import useEditor from './../../../../../store/use-editor'
import { InlineRenameInput } from './inline-rename-input'
import { handleTreeSelection, TreeNode, TreeNodeWrapper } from './tree-node'
import { TreeNodeActions } from './tree-node-actions'

interface CeilingTreeNodeProps {
  node: CeilingNode
  depth: number
  isLast?: boolean
}

export function CeilingTreeNode({ node, depth, isLast }: CeilingTreeNodeProps) {
  const [expanded, setExpanded] = useState(false)
  const [isEditing, setIsEditing] = useState(false)
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
      while (current && current.parentId) {
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
    if (!handled && useEditor.getState().phase === 'furnish') {
      useEditor.getState().setPhase('structure')
    }
  }

  const handleDoubleClick = () => {
    setIsEditing(true)
  }

  const handleMouseEnter = () => {
    setHoveredId(node.id)
  }

  const handleMouseLeave = () => {
    setHoveredId(null)
  }

  // Calculate approximate area from polygon
  const area = calculatePolygonArea(node.polygon).toFixed(1)
  const defaultName = `Ceiling (${area}m²)`

  return (
    <TreeNodeWrapper
      actions={<TreeNodeActions node={node} />}
      depth={depth}
      expanded={expanded}
      hasChildren={node.children.length > 0}
      icon={
        <Image alt="" className="object-contain" height={14} src="/icons/ceiling.png" width={14} />
      }
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
      {node.children.map((childId, index) => (
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

/**
 * Calculate the area of a polygon using the shoelace formula
 */
function calculatePolygonArea(polygon: Array<[number, number]>): number {
  if (polygon.length < 3) return 0

  let area = 0
  const n = polygon.length

  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    area += polygon[i]![0] * polygon[j]![1]
    area -= polygon[j]![0] * polygon[i]![1]
  }

  return Math.abs(area) / 2
}

import { useScene, type ZoneNode } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { memo, useCallback, useState } from 'react'
import { ColorDot } from './../../../../../components/ui/primitives/color-dot'
import { InlineRenameInput } from './inline-rename-input'
import { focusTreeNode, TreeNodeWrapper } from './tree-node'
import { TreeNodeActions } from './tree-node-actions'

interface ZoneTreeNodeProps {
  nodeId: ZoneNode['id']
  depth: number
  isLast?: boolean
}

export const ZoneTreeNode = memo(function ZoneTreeNode({
  nodeId,
  depth,
  isLast,
}: ZoneTreeNodeProps) {
  const [isEditing, setIsEditing] = useState(false)
  const updateNode = useScene((state) => state.updateNode)
  const isVisible = useScene((s) => s.nodes[nodeId]?.visible !== false)
  const color = useScene((s) => (s.nodes[nodeId] as ZoneNode | undefined)?.color ?? '#3b82f6')
  const polygon = useScene((s) => (s.nodes[nodeId] as ZoneNode | undefined)?.polygon ?? [])
  const isSelected = useViewer((state) => state.selection.zoneId === nodeId)
  const isHovered = useViewer((state) => state.hoveredId === nodeId)
  const setSelection = useViewer((state) => state.setSelection)
  const setHoveredId = useViewer((state) => state.setHoveredId)

  const handleClick = useCallback(() => setSelection({ zoneId: nodeId }), [nodeId, setSelection])
  const handleDoubleClick = useCallback(() => focusTreeNode(nodeId), [nodeId])
  const handleMouseEnter = useCallback(() => setHoveredId(nodeId), [nodeId, setHoveredId])
  const handleMouseLeave = useCallback(() => setHoveredId(null), [setHoveredId])
  const handleStartEditing = useCallback(() => setIsEditing(true), [])
  const handleStopEditing = useCallback(() => setIsEditing(false), [])

  // Calculate approximate area from polygon
  const area = calculatePolygonArea(polygon).toFixed(1)
  const defaultName = `Zone (${area}m²)`

  return (
    <TreeNodeWrapper
      actions={<TreeNodeActions nodeId={nodeId} />}
      depth={depth}
      expanded={false}
      hasChildren={false}
      icon={<ColorDot color={color ?? '#3b82f6'} onChange={(c) => updateNode(nodeId, { color: c })} />}
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
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
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
    const current = polygon[i]
    const next = polygon[j]
    if (!(current && next)) continue
    area += current[0] * next[1]
    area -= next[0] * current[1]
  }

  return Math.abs(area) / 2
}

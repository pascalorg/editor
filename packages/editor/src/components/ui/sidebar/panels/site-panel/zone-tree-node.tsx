import { DEFAULT_ZONE_COLOR, useScene, type ZoneNode } from '@pascal-app/core'
import { useZoneDisplayColor } from './../../../../../hooks/use-zone-display-color'
import { useViewer } from '@pascal-app/viewer'
import { memo, useCallback, useState } from 'react'
import { ColorDot } from './../../../../../components/ui/primitives/color-dot'
import { formatAreaLabel } from './../../../../../lib/measurements'
import {
  selectZoneOrRoom,
  useZoneSelected,
  zoneKindLabel,
} from './../../../../../lib/room-zone-routing'
import { toggleZoneMembership } from './../../../../../lib/units'
import { InlineRenameInput } from './inline-rename-input'
import { focusTreeNode, TreeNodeWrapper } from './tree-node'
import { TreeNodeActions } from './tree-node-actions'
import { ZoneMembershipCheckbox } from './zone-membership-checkbox'

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
  const color = useZoneDisplayColor(nodeId)
  const polygon = useScene((s) => (s.nodes[nodeId] as ZoneNode | undefined)?.polygon ?? [])
  const isSelected = useZoneSelected(nodeId)
  const kind = useScene((s) => zoneKindLabel(s.nodes[nodeId] as ZoneNode | undefined))
  const isHovered = useViewer((state) => state.hoveredId === nodeId)
  const setHoveredId = useViewer((state) => state.setHoveredId)
  const unit = useViewer((state) => state.unit)
  const focusedUnitId = useViewer((state) => state.focusedUnitId)
  const focusedUnit = useScene((s) => {
    const focused = focusedUnitId ? s.nodes[focusedUnitId] : undefined
    return focused?.type === 'unit' ? focused : null
  })

  const handleClick = useCallback(() => selectZoneOrRoom(nodeId), [nodeId])
  const handleDoubleClick = useCallback(() => focusTreeNode(nodeId), [nodeId])
  const handleMouseEnter = useCallback(() => setHoveredId(nodeId), [nodeId, setHoveredId])
  const handleMouseLeave = useCallback(() => setHoveredId(null), [setHoveredId])
  const handleStartEditing = useCallback(() => setIsEditing(true), [])
  const handleStopEditing = useCallback(() => setIsEditing(false), [])

  const defaultName = `${kind} (${formatAreaLabel(calculatePolygonArea(polygon), unit)})`

  return (
    <TreeNodeWrapper
      actions={<TreeNodeActions nodeId={nodeId} />}
      depth={depth}
      expanded={false}
      hasChildren={false}
      icon={
        <ColorDot color={color ?? DEFAULT_ZONE_COLOR} onChange={(c) => updateNode(nodeId, { color: c })} />
      }
      isHovered={isHovered}
      isLast={isLast}
      isSelected={isSelected}
      keepIconColor
      isVisible={isVisible}
      label={
        <span className="flex min-w-0 items-center">
          {focusedUnit && (
            <ZoneMembershipCheckbox
              checked={focusedUnit.members.includes(nodeId)}
              onToggle={() => toggleZoneMembership(focusedUnit.id, nodeId)}
              unitName={focusedUnit.name || 'Unit'}
            />
          )}
          <InlineRenameInput
            defaultName={defaultName}
            isEditing={isEditing}
            nodeId={nodeId}
            onStartEditing={handleStartEditing}
            onStopEditing={handleStopEditing}
          />
        </span>
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

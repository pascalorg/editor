import { useScene, type ZoneNode } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { useState } from 'react'
import { formatArea } from '../../../../../lib/measurements'
import { ColorDot } from './../../../../../components/ui/primitives/color-dot'
import { calculatePolygonArea } from './polygon-math'
import { InlineRenameInput } from './inline-rename-input'
import { TreeNodeWrapper } from './tree-node'
import { TreeNodeActions } from './tree-node-actions'

interface ZoneTreeNodeProps {
  node: ZoneNode
  depth: number
  isLast?: boolean
}

export function ZoneTreeNode({ node, depth, isLast }: ZoneTreeNodeProps) {
  const [isEditing, setIsEditing] = useState(false)
  const updateNode = useScene((state) => state.updateNode)
  const unitSystem = useViewer((state) => state.unitSystem)
  const isSelected = useViewer((state) => state.selection.zoneId === node.id)
  const isHovered = useViewer((state) => state.hoveredId === node.id)
  const setSelection = useViewer((state) => state.setSelection)
  const setHoveredId = useViewer((state) => state.setHoveredId)

  const handleClick = () => {
    setSelection({ zoneId: node.id })
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
  const defaultName = `Zone (${formatArea(calculatePolygonArea(node.polygon), unitSystem)})`

  return (
    <TreeNodeWrapper
      actions={<TreeNodeActions node={node} />}
      depth={depth}
      expanded={false}
      hasChildren={false}
      icon={<ColorDot color={node.color} onChange={(color) => updateNode(node.id, { color })} />}
      isHovered={isHovered}
      isLast={isLast}
      isSelected={isSelected}
      label={
        <InlineRenameInput
          defaultName={defaultName}
          isEditing={isEditing}
          node={node}
          onStartEditing={() => setIsEditing(true)}
          onStopEditing={() => setIsEditing(false)}
        />
      }
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onToggle={() => {}}
    />
  )
}

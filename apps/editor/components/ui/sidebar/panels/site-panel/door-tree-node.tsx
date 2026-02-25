'use client'

import { DoorNode } from "@pascal-app/core"
import { useViewer } from "@pascal-app/viewer"
import Image from "next/image"
import { useState } from "react"
import { InlineRenameInput } from "./inline-rename-input"
import { TreeNodeWrapper } from "./tree-node"
import { TreeNodeActions } from "./tree-node-actions"

interface DoorTreeNodeProps {
  node: DoorNode
  depth: number
}

export function DoorTreeNode({ node, depth }: DoorTreeNodeProps) {
  const [isEditing, setIsEditing] = useState(false)
  const isSelected = useViewer((state) => state.selection.selectedIds.includes(node.id))
  const isHovered = useViewer((state) => state.hoveredId === node.id)
  const setSelection = useViewer((state) => state.setSelection)
  const setHoveredId = useViewer((state) => state.setHoveredId)

  const defaultName = `Door (${node.width}×${node.height}m)`

  return (
    <TreeNodeWrapper
      icon={<Image src="/icons/door.png" alt="" width={14} height={14} className="object-contain" />}
      label={
        <InlineRenameInput
          node={node}
          isEditing={isEditing}
          onStopEditing={() => setIsEditing(false)}
          onStartEditing={() => setIsEditing(true)}
          defaultName={defaultName}
        />
      }
      depth={depth}
      hasChildren={false}
      expanded={false}
      onToggle={() => {}}
      onClick={() => setSelection({ selectedIds: [node.id] })}
      onDoubleClick={() => setIsEditing(true)}
      onMouseEnter={() => setHoveredId(node.id)}
      onMouseLeave={() => setHoveredId(null)}
      isSelected={isSelected}
      isHovered={isHovered}
      isVisible={node.visible !== false}
      actions={<TreeNodeActions node={node} />}
    />
  )
}

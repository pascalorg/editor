import type { LevelNode } from '@vesper/core'
import { useViewer } from '@vesper/viewer'
import { Layers } from 'lucide-react'
import { useState } from 'react'
import { InlineRenameInput } from './inline-rename-input'
import { TreeNode, TreeNodeWrapper } from './tree-node'
import { TreeNodeActions } from './tree-node-actions'

interface LevelTreeNodeProps {
  node: LevelNode
  depth: number
  isLast?: boolean
}

export function LevelTreeNode({ node, depth, isLast }: LevelTreeNodeProps) {
  const [expanded, setExpanded] = useState(true)
  const [isEditing, setIsEditing] = useState(false)
  const isSelected = useViewer((state) => state.selection.levelId === node.id)
  const isHovered = useViewer((state) => state.hoveredId === node.id)
  const setSelection = useViewer((state) => state.setSelection)

  const handleClick = () => {
    setSelection({ levelId: node.id })
  }

  const handleDoubleClick = () => {
    setIsEditing(true)
  }

  const defaultName = `Level ${node.level}`

  return (
    <TreeNodeWrapper
      actions={<TreeNodeActions node={node} />}
      depth={depth}
      expanded={expanded}
      hasChildren={node.children.length > 0}
      icon={<Layers className="h-3.5 w-3.5" />}
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

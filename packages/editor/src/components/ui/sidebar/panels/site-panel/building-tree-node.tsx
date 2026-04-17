import { type AnyNodeId, type BuildingNode, LevelNode, useScene } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { Building2, Plus } from 'lucide-react'
import { memo, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from './../../../../../components/ui/primitives/tooltip'
import { focusTreeNode, TreeNode, TreeNodeWrapper } from './tree-node'
import { TreeNodeActions } from './tree-node-actions'

interface BuildingTreeNodeProps {
  nodeId: AnyNodeId
  depth: number
  isLast?: boolean
}

export const BuildingTreeNode = memo(function BuildingTreeNode({
  nodeId,
  depth,
  isLast,
}: BuildingTreeNodeProps) {
  const [expanded, setExpanded] = useState(true)
  const createNode = useScene((state) => state.createNode)
  const isVisible = useScene((s) => s.nodes[nodeId]?.visible !== false)
  const name = useScene((s) => s.nodes[nodeId]?.name)
  const children = useScene(
    useShallow((s) => (s.nodes[nodeId] as BuildingNode | undefined)?.children ?? []),
  )
  const isSelected = useViewer((state) => state.selection.buildingId === nodeId)
  const isHovered = useViewer((state) => state.hoveredId === nodeId)
  const setSelection = useViewer((state) => state.setSelection)

  const handleClick = () => {
    setSelection({ buildingId: nodeId })
  }

  const handleAddLevel = (e: React.MouseEvent) => {
    e.stopPropagation()
    const newLevel = LevelNode.parse({
      level: children.length,
      children: [],
      parentId: nodeId,
    })
    createNode(newLevel, nodeId)
  }

  return (
    <TreeNodeWrapper
      actions={
        <div className="flex items-center gap-0.5">
          <TreeNodeActions nodeId={nodeId} />
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                className="flex h-5 w-5 items-center justify-center rounded hover:bg-primary-foreground/20"
                onClick={handleAddLevel}
              >
                <Plus className="h-3 w-3" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">Add new level</TooltipContent>
          </Tooltip>
        </div>
      }
      depth={depth}
      expanded={expanded}
      hasChildren={children.length > 0}
      icon={<Building2 className="h-3.5 w-3.5" />}
      isHovered={isHovered}
      isLast={isLast}
      isSelected={isSelected}
      isVisible={isVisible}
      label={name || 'Building'}
      onClick={handleClick}
      onDoubleClick={() => focusTreeNode(nodeId)}
      onToggle={() => setExpanded(!expanded)}
    >
      {children.map((childId, index) => (
        <TreeNode
          depth={depth + 1}
          isLast={index === children.length - 1}
          key={childId}
          nodeId={childId}
        />
      ))}
    </TreeNodeWrapper>
  )
})

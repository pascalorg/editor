import { Icon as IconifyIcon } from '@iconify/react'
import { type AnyNodeId, nodeRegistry, useScene } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import Image from 'next/image'
import { memo, useCallback, useEffect, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { resolveNodeSnapTarget, SnapTargetIcon } from '../../../snap-target-badge'
import { InlineRenameInput } from './inline-rename-input'
import {
  focusTreeNode,
  handleTreeSelection,
  routeTreeSelectionToNode,
  TreeNode,
  TreeNodeWrapper,
} from './tree-node'
import { TreeNodeActions } from './tree-node-actions'
import { resolveTreeChildIds, treeContainsDescendant } from './tree-structure'

interface RegistryTreeNodeProps {
  nodeId: AnyNodeId
  depth: number
  isLast?: boolean
}

/**
 * Generic, registry-driven tree-node row powered by `def.presentation` and
 * `def.tree`. Replaces the per-kind boilerplate
 * components that differed only in their default name and icon — today the
 * roof vents plus cabinet rows. Register a kind in `treeNodeByType` against
 * this component instead of authoring another copy.
 */
export const RegistryTreeNode = memo(function RegistryTreeNode({
  nodeId,
  depth,
  isLast,
}: RegistryTreeNodeProps) {
  const [isEditing, setIsEditing] = useState(false)
  const [expanded, setExpanded] = useState(true)
  const isVisible = useScene((s) => s.nodes[nodeId]?.visible !== false)
  const node = useScene((s) => s.nodes[nodeId])
  const children = useScene(useShallow((s) => resolveTreeChildIds(nodeId, s.nodes)))
  const isSelected = useViewer((state) => state.selection.selectedIds.includes(nodeId))
  const isHovered = useViewer((state) => state.hoveredId === nodeId)
  const setSelection = useViewer((state) => state.setSelection)
  const setHoveredId = useViewer((state) => state.setHoveredId)

  const presentation = node ? nodeRegistry.get(node.type)?.presentation : undefined
  const tree = node ? nodeRegistry.get(node.type)?.tree : undefined
  const icon = presentation?.icon
  const iconSrc = icon?.kind === 'url' ? icon.src : '/icons/roof.webp'
  const iconElement =
    icon?.kind === 'iconify' ? (
      <IconifyIcon className="opacity-60" height={14} icon={icon.name} width={14} />
    ) : (
      <Image
        alt=""
        className="object-contain opacity-60"
        height={14}
        src={iconSrc}
        width={14}
      />
    )
  const snapTarget = resolveNodeSnapTarget(node)
  const defaultName =
    node ? tree?.label?.(node, useScene.getState().nodes) || node.name || presentation?.label || 'Node' : 'Node'
  const hasChildren = children.length > 0

  useEffect(() => {
    return useViewer.subscribe((state) => {
      const { selectedIds } = state.selection
      if (selectedIds.length === 0) return
      const nodes = useScene.getState().nodes
      for (const id of selectedIds) {
        if (treeContainsDescendant(nodeId, id as AnyNodeId, nodes)) {
          setExpanded(true)
          return
        }
      }
    })
  }, [nodeId])

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      handleTreeSelection(
        e,
        nodeId,
        useViewer.getState().selection.selectedIds,
        setSelection,
      )
      routeTreeSelectionToNode(node)
    },
    [node, nodeId, setSelection],
  )

  return (
    <TreeNodeWrapper
      actions={<TreeNodeActions nodeId={nodeId} />}
      depth={depth}
      expanded={expanded}
      hasChildren={hasChildren}
      icon={
        snapTarget ? (
          <SnapTargetIcon target={snapTarget}>{iconElement}</SnapTargetIcon>
        ) : (
          iconElement
        )
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
          onStartEditing={() => setIsEditing(true)}
          onStopEditing={() => setIsEditing(false)}
        />
      }
      nodeId={nodeId}
      onClick={handleClick}
      onDoubleClick={() => focusTreeNode(nodeId)}
      onMouseEnter={() => setHoveredId(nodeId)}
      onMouseLeave={() => setHoveredId(null)}
      onToggle={() => setExpanded((prev) => !prev)}
    >
      {hasChildren &&
        children.map((childId, index) => (
          <TreeNode
            depth={depth + 1}
            isLast={index === children.length - 1}
            key={childId}
            nodeId={childId as AnyNodeId}
          />
        ))}
    </TreeNodeWrapper>
  )
})

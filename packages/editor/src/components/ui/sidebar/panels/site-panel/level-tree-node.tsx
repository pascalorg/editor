import { type LevelNode, useLocale, usePascalI18n, useScene } from '@pascal-app/core'
import { markPerfAction, useViewer } from '@pascal-app/viewer'
import { Layers } from 'lucide-react'
import { memo, useCallback, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { InlineRenameInput } from './inline-rename-input'
import { focusTreeNode, TreeNode, TreeNodeWrapper } from './tree-node'
import { TreeNodeActions } from './tree-node-actions'
import { authoredLevelName, localizedLevelName } from '../../../../../i18n/level-name'

interface LevelTreeNodeProps {
  nodeId: LevelNode['id']
  depth: number
  isLast?: boolean
}

export const LevelTreeNode = memo(function LevelTreeNode({
  nodeId,
  depth,
  isLast,
}: LevelTreeNodeProps) {
  const i18n = usePascalI18n()
  const locale = useLocale()
  const [expanded, setExpanded] = useState(true)
  const [isEditing, setIsEditing] = useState(false)
  const isVisible = useScene((s) => s.nodes[nodeId]?.visible !== false)
  const children = useScene(
    useShallow((s) => (s.nodes[nodeId] as LevelNode | undefined)?.children ?? []),
  )
  const level = useScene((s) => (s.nodes[nodeId] as LevelNode | undefined)?.level ?? 0)
  const levelName = useScene((s) => (s.nodes[nodeId] as LevelNode | undefined)?.name)
  const isSelected = useViewer((state) => state.selection.levelId === nodeId)
  const isHovered = useViewer((state) => state.hoveredId === nodeId)
  const setSelection = useViewer((state) => state.setSelection)

  const handleClick = useCallback(() => {
    if (!isSelected) markPerfAction('level-switch', nodeId)
    setSelection({ levelId: nodeId })
  }, [isSelected, nodeId, setSelection])
  const handleDoubleClick = useCallback(() => focusTreeNode(nodeId), [nodeId])
  const handleToggle = useCallback(() => setExpanded((prev) => !prev), [])
  const handleStartEditing = useCallback(() => setIsEditing(true), [])
  const handleStopEditing = useCallback(() => setIsEditing(false), [])

  const defaultName = localizedLevelName({ level }, i18n, locale)
  const displayName = localizedLevelName({ name: levelName, level }, i18n, locale)

  return (
    <TreeNodeWrapper
      actions={<TreeNodeActions nodeId={nodeId} />}
      depth={depth}
      expanded={expanded}
      hasChildren={children.length > 0}
      icon={<Layers className="h-3.5 w-3.5" />}
      isHovered={isHovered}
      isLast={isLast}
      isSelected={isSelected}
      isVisible={isVisible}
      label={
        <InlineRenameInput
          defaultName={defaultName}
          displayName={displayName}
          editableName={(name) => authoredLevelName({ name, level })}
          isEditing={isEditing}
          nodeId={nodeId}
          onStartEditing={handleStartEditing}
          onStopEditing={handleStopEditing}
        />
      }
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
      onToggle={handleToggle}
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

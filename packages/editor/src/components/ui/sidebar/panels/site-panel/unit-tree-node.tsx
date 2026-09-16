import {
  type AnyNodeId,
  getLevelDisplayName,
  type LevelNode,
  type UnitNode,
  unitWarnings,
  useScene,
  type ZoneNode,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { AlertTriangle, Trash2, X } from 'lucide-react'
import { memo, useCallback, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { ColorDot } from './../../../../../components/ui/primitives/color-dot'
import { assignZoneToUnit, enterUnitFocus } from './../../../../../lib/units'
import { InlineRenameInput } from './inline-rename-input'
import { routeTreeSelectionToNode, TreeNodeWrapper } from './tree-node'

type UnitWarningCode = ReturnType<typeof unitWarnings>[number]['code']

const WARNING_LABELS: Record<UnitWarningCode, string> = {
  empty: 'No zones in this unit',
  'non-adjacent-levels': 'Members sit on non-adjacent levels',
}

const ACTION_BUTTON_CLASS =
  'flex h-6 w-6 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-black/5 hover:text-foreground dark:hover:bg-white/10'

interface UnitZoneRowProps {
  zoneId: ZoneNode['id']
  depth: number
  isLast?: boolean
  onRemove?: (zoneId: ZoneNode['id']) => void
}

/** One member zone under a unit: name + level, click selects it. */
export const UnitZoneRow = memo(function UnitZoneRow({
  zoneId,
  depth,
  isLast,
  onRemove,
}: UnitZoneRowProps) {
  const zone = useScene((s) => s.nodes[zoneId] as ZoneNode | undefined)
  const levelLabel = useScene((s) => {
    const level = zone?.parentId ? (s.nodes[zone.parentId as AnyNodeId] as LevelNode | undefined) : undefined
    return level?.type === 'level' ? getLevelDisplayName(level) : null
  })
  const isSelected = useViewer((s) => s.selection.zoneId === zoneId)
  const isHovered = useViewer((s) => s.hoveredId === zoneId)
  const setSelection = useViewer((s) => s.setSelection)
  const setHoveredId = useViewer((s) => s.setHoveredId)

  const handleClick = useCallback(
    (event: React.MouseEvent) => {
      event.stopPropagation()
      if (!zone) return
      setSelection({ levelId: zone.parentId as LevelNode['id'], zoneId })
      routeTreeSelectionToNode(zone)
    },
    [zone, zoneId, setSelection],
  )

  if (!zone) return null

  return (
    <TreeNodeWrapper
      actions={
        onRemove ? (
          <button
            className={ACTION_BUTTON_CLASS}
            onClick={(event) => {
              event.stopPropagation()
              onRemove(zoneId)
            }}
            title="Remove from unit"
            type="button"
          >
            <X className="h-3 w-3" />
          </button>
        ) : undefined
      }
      depth={depth}
      expanded={false}
      hasChildren={false}
      icon={
        <span
          className="h-3 w-3 rounded-sm border border-border/50"
          style={{ backgroundColor: zone.color }}
        />
      }
      isHovered={isHovered}
      isLast={isLast}
      isSelected={isSelected}
      keepIconColor
      label={
        <span className="flex min-w-0 items-baseline gap-1.5">
          <span className="truncate">{zone.name || 'Zone'}</span>
          {levelLabel && (
            <span className="shrink-0 text-muted-foreground text-xs">{levelLabel}</span>
          )}
        </span>
      }
      nodeId={zoneId}
      onClick={handleClick}
      onMouseEnter={() => setHoveredId(zoneId)}
      onMouseLeave={() => setHoveredId(null)}
      onToggle={() => {}}
    />
  )
})

interface UnitTreeNodeProps {
  nodeId: AnyNodeId
  depth: number
  isLast?: boolean
}

export const UnitTreeNode = memo(function UnitTreeNode({
  nodeId,
  depth,
  isLast,
}: UnitTreeNodeProps) {
  const unitId = nodeId as UnitNode['id']
  const [isEditing, setIsEditing] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const updateNode = useScene((s) => s.updateNode)
  const deleteNode = useScene((s) => s.deleteNode)
  const color = useScene((s) => (s.nodes[nodeId] as UnitNode | undefined)?.color)
  const members = useScene(
    useShallow((s) => (s.nodes[nodeId] as UnitNode | undefined)?.members ?? []),
  )
  const warningCodes = useScene(
    useShallow((s) => {
      const unit = s.nodes[nodeId]
      return unit?.type === 'unit' ? unitWarnings(unit, s.nodes).map((w) => w.code) : []
    }),
  )
  const isSelected = useViewer((s) => s.selection.selectedIds.includes(nodeId))
  const isHovered = useViewer((s) => s.hoveredId === nodeId)
  const setHoveredId = useViewer((s) => s.setHoveredId)
  const isFocused = useViewer((s) => s.focusedUnitId === unitId)

  const handleClick = useCallback(
    (event: React.MouseEvent) => {
      event.stopPropagation()
      enterUnitFocus(unitId)
    },
    [unitId],
  )

  const handleRemoveMember = useCallback(
    (zoneId: ZoneNode['id']) => assignZoneToUnit(zoneId, null),
    [],
  )

  const warningTitle = [...new Set(warningCodes)].map((code) => WARNING_LABELS[code]).join('\n')

  return (
    <TreeNodeWrapper
      actions={
        <button
          className={ACTION_BUTTON_CLASS}
          onClick={(event) => {
            event.stopPropagation()
            deleteNode(unitId)
          }}
          title="Delete unit"
          type="button"
        >
          <Trash2 className="h-3 w-3" />
        </button>
      }
      depth={depth}
      expanded={expanded}
      hasChildren={members.length > 0}
      icon={
        <ColorDot
          color={color ?? '#f59e0b'}
          onChange={(next) => updateNode(unitId, { color: next })}
        />
      }
      isHovered={isHovered}
      isLast={isLast}
      isSelected={isSelected}
      keepIconColor
      label={
        <span className="flex min-w-0 items-center gap-1.5">
          <InlineRenameInput
            defaultName="Unit"
            isEditing={isEditing}
            nodeId={nodeId}
            onStartEditing={() => setIsEditing(true)}
            onStopEditing={() => setIsEditing(false)}
          />
          {isFocused && (
            <span className="shrink-0 rounded-full bg-primary/15 px-1.5 text-[10px] text-primary leading-4">
              Focused
            </span>
          )}
          {warningCodes.length > 0 && (
            <span className="shrink-0 text-muted-foreground" title={warningTitle}>
              <AlertTriangle className="h-3 w-3" />
            </span>
          )}
        </span>
      }
      nodeId={nodeId}
      onClick={handleClick}
      onMouseEnter={() => setHoveredId(nodeId)}
      onMouseLeave={() => setHoveredId(null)}
      onToggle={() => setExpanded((value) => !value)}
    >
      {members.map((zoneId, index) => (
        <UnitZoneRow
          depth={depth + 1}
          isLast={index === members.length - 1}
          key={zoneId}
          onRemove={handleRemoveMember}
          zoneId={zoneId}
        />
      ))}
    </TreeNodeWrapper>
  )
})

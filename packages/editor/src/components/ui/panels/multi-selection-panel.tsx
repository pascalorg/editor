'use client'

import {
  type AnyNodeId,
  type BuildingNode,
  resolveBuildingForLevel,
  useScene,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { Building2, Copy, Group, Trash2, Ungroup } from 'lucide-react'
import { useMemo } from 'react'
import { deleteSelection, duplicateSelectionAndPickUp } from '../../editor/group-actions'
import { collectSelectableCandidateIds } from '../../tools/select/select-candidates'
import {
  canCreateSessionGroup,
  selectionIntersectsSessionGroup,
  selectionMatchesSessionGroup,
} from '../../../lib/session-groups'
import useSessionGroups, {
  groupCurrentSelection,
  ungroupCurrentSelection,
} from '../../../store/use-session-groups'
import { ActionButton, ActionGroup } from '../controls/action-button'
import { PanelWrapper } from './panel-wrapper'
import { formatSelectionBreakdown } from './selection-breakdown'

/** The building holding the level, when the selection is everything selectable on it. */
function useWholeLevelBuildingId(selectedIds: readonly string[]) {
  const levelId = useViewer((s) => s.selection.levelId)
  const nodes = useScene((s) => s.nodes)
  return useMemo(() => {
    if (!levelId) return null
    const candidates = collectSelectableCandidateIds()
    if (candidates.length === 0) return null
    const selected = new Set(selectedIds)
    if (!candidates.every((id) => selected.has(id))) return null
    return resolveBuildingForLevel(levelId as AnyNodeId, nodes) ?? null
  }, [levelId, nodes, selectedIds])
}

/** The building's own selection (no level): its floating pill offers the whole-building Move. */
function selectBuilding(buildingId: AnyNodeId) {
  useViewer.getState().setSelection({ buildingId: buildingId as BuildingNode['id'] })
}

export function MultiSelectionActions() {
  const selectedIds = useViewer((s) => s.selection.selectedIds)
  const sessionGroups = useSessionGroups((s) => s.groups)
  const sceneNodes = useScene((s) => s.nodes)
  const liveIds = useMemo(() => new Set(Object.keys(sceneNodes)), [sceneNodes])
  const showGroup = useMemo(
    () => canCreateSessionGroup(sessionGroups, selectedIds, liveIds),
    [sessionGroups, selectedIds, liveIds],
  )
  const showUngroup = useMemo(
    () => selectionIntersectsSessionGroup(sessionGroups, selectedIds, liveIds),
    [sessionGroups, selectedIds, liveIds],
  )

  const buildingId = useWholeLevelBuildingId(selectedIds)

  return (
    <ActionGroup className="flex-wrap">
      {buildingId && (
        <ActionButton
          className="basis-full whitespace-nowrap"
          icon={<Building2 className="h-4 w-4" />}
          label="Select building"
          onClick={() => selectBuilding(buildingId)}
          title="Select the whole building to move all its levels"
        />
      )}
      {showGroup && (
        <ActionButton
          className="min-w-20 px-2"
          icon={<Group className="h-4 w-4" />}
          label="Group"
          onClick={() => groupCurrentSelection()}
          title="Group (Ctrl/Cmd+G)"
        />
      )}
      {showUngroup && (
        <ActionButton
          className="min-w-20 px-2"
          icon={<Ungroup className="h-4 w-4" />}
          label="Ungroup"
          onClick={() => ungroupCurrentSelection()}
          title="Ungroup (Ctrl/Cmd+Shift+G)"
        />
      )}
      <ActionButton
        className="min-w-20 px-2"
        icon={<Copy className="h-4 w-4" />}
        label="Duplicate"
        onClick={() => duplicateSelectionAndPickUp()}
      />
      <ActionButton
        className="min-w-20 px-2 border-red-500/40 text-red-200 hover:bg-red-500/15"
        icon={<Trash2 className="h-4 w-4 text-red-400" />}
        label="Delete"
        onClick={() => deleteSelection()}
      />
    </ActionGroup>
  )
}

/**
 * Docked multi-selection panel. Includes Group / Ungroup for session selection sets.
 */
export function MultiSelectionPanel({ footer }: { footer?: React.ReactNode }) {
  const selectedIds = useViewer((s) => s.selection.selectedIds)
  const setSelection = useViewer((s) => s.setSelection)
  const sessionGroups = useSessionGroups((s) => s.groups)
  const breakdown = useScene((s) =>
    formatSelectionBreakdown(selectedIds.map((id) => s.nodes[id as AnyNodeId]?.type)),
  )
  const sceneNodes = useScene((s) => s.nodes)
  const liveIds = useMemo(() => new Set(Object.keys(sceneNodes)), [sceneNodes])
  const matchedGroup = useMemo(
    () => selectionMatchesSessionGroup(sessionGroups, selectedIds, liveIds),
    [sessionGroups, selectedIds, liveIds],
  )

  return (
    <PanelWrapper
      footer={footer}
      icon="/icons/select.webp"
      onClose={() => setSelection({ selectedIds: [] })}
      title={
        matchedGroup
          ? `${matchedGroup.label} · ${selectedIds.length}`
          : `${selectedIds.length} selected`
      }
      width={320}
    >
      {breakdown && <div className="px-3 py-3 text-muted-foreground text-xs">{breakdown}</div>}
      {matchedGroup && (
        <div className="border-border/50 border-t px-3 py-2 text-muted-foreground text-xs">
          {matchedGroup.label} (session only). Plain click reselects all members. Not saved with the
          project.
        </div>
      )}
      <div className="border-border/50 border-t p-3">
        <MultiSelectionActions />
      </div>
    </PanelWrapper>
  )
}

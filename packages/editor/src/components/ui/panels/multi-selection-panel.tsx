'use client'

import { type AnyNodeId, useScene } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { Copy, Group, Trash2, Ungroup } from 'lucide-react'
import { useMemo } from 'react'
import { deleteSelection, duplicateSelectionAndPickUp } from '../../editor/group-actions'
import {
  canCreateSessionGroup,
  selectionIntersectsSessionGroup,
  selectionMatchesSessionGroup,
} from '../../../lib/session-groups'
import { useTranslations } from '../../../lib/i18n'
import useSessionGroups, {
  groupCurrentSelection,
  ungroupCurrentSelection,
} from '../../../store/use-session-groups'
import { ActionButton, ActionGroup } from '../controls/action-button'
import { PanelWrapper } from './panel-wrapper'
import { formatSelectionBreakdown } from './selection-breakdown'

export function MultiSelectionActions() {
  const t = useTranslations()
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

  return (
    <ActionGroup>
      {showGroup && (
        <ActionButton
          icon={<Group className="h-4 w-4" />}
          label={t('panel.action.group')}
          onClick={() => groupCurrentSelection()}
          title={t('nodeActions.groupShortcut')}
        />
      )}
      {showUngroup && (
        <ActionButton
          icon={<Ungroup className="h-4 w-4" />}
          label={t('panel.action.ungroup')}
          onClick={() => ungroupCurrentSelection()}
          title={t('nodeActions.ungroupShortcut')}
        />
      )}
      <ActionButton
        icon={<Copy className="h-4 w-4" />}
        label={t('panel.action.duplicate')}
        onClick={() => duplicateSelectionAndPickUp()}
      />
      <ActionButton
        className="border-red-500/40 text-red-200 hover:bg-red-500/15"
        icon={<Trash2 className="h-4 w-4 text-red-400" />}
        label={t('panel.action.delete')}
        onClick={() => deleteSelection()}
      />
    </ActionGroup>
  )
}

/**
 * Docked multi-selection panel. Includes Group / Ungroup for session selection sets.
 */
export function MultiSelectionPanel({ footer }: { footer?: React.ReactNode }) {
  const t = useTranslations()
  const selectedIds = useViewer((s) => s.selection.selectedIds)
  const setSelection = useViewer((s) => s.setSelection)
  const sessionGroups = useSessionGroups((s) => s.groups)
  const breakdown = useScene((s) =>
    formatSelectionBreakdown(
      selectedIds.map((id) => s.nodes[id as AnyNodeId]?.type),
      t,
    ),
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
          ? t('panel.multiSelection.withGroup', { label: matchedGroup.label, count: selectedIds.length })
          : t('panel.multiSelection.selected', { count: selectedIds.length })
      }
      width={320}
    >
      {breakdown && <div className="px-3 py-3 text-muted-foreground text-xs">{breakdown}</div>}
      {matchedGroup && (
        <div className="border-border/50 border-t px-3 py-2 text-muted-foreground text-xs">
          {t('panel.multiSelection.sessionOnlyFooter', { label: matchedGroup.label })}
        </div>
      )}
      <div className="border-border/50 border-t p-3">
        <MultiSelectionActions />
      </div>
    </PanelWrapper>
  )
}

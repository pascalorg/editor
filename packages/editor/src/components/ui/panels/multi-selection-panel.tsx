'use client'

import {
  type AnyNode,
  type AnyNodeId,
  type BuildingNode,
  resolveBuildingForLevel,
  runAsSingleSceneHistoryStep,
  useScene,
} from '@pascal-app/core'
import { unwrapCorner, windowMergeOffer } from '@pascal-app/core/building'
import { useViewer } from '@pascal-app/viewer'
import { Building2, Copy, Group, Merge, Split, Trash2, Ungroup } from 'lucide-react'
import { useMemo } from 'react'
import { deleteSelection, duplicateSelectionAndPickUp } from '../../editor/group-actions'
import { formatLinearMeasurement } from '../../../lib/measurements'
import { triggerSFX } from '../../../lib/sfx-bus'
import { writeWindowChanges } from '../../../lib/window-changes'
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

/**
 * Why two selected windows will not merge, for the person who selected them: the refusal's own
 * message is the agents' (node ids, metres), so the panel words its code, in the editor's units.
 */
function mergeRefusalNote(
  refusal: { code: string; details: Record<string, unknown> },
  nodes: Record<string, AnyNode>,
  length: (meters: number) => string,
): string {
  const { blockingId, limit } = refusal.details as { blockingId?: string; limit?: number }
  const reach = length(limit ?? 0)
  const blocking = nodes[blockingId ?? '']
  const blockingKind = !blocking
    ? 'something'
    : blocking.type === 'item'
      ? 'an item'
      : `a ${blocking.type}`
  switch (refusal.code) {
    case 'window_already_joined':
      return 'One of them already wraps another corner. Unwrap it first.'
    case 'window_not_on_wall':
      return 'A roof or dormer window cannot join another window.'
    case 'windows_not_adjacent':
      return `They are too far apart. Windows merge with at most ${reach} between them.`
    case 'opening_between':
      return `There is ${blockingKind} between them.`
    case 'walls_not_meeting':
      return 'Their walls do not meet at a corner.'
    case 'corner_angle':
      return 'Their walls meet at too sharp or too flat an angle for a corner window.'
    case 'window_not_at_corner':
      return `One of them is too far from the corner. A window joins one within ${reach} of it.`
    case 'height_exceeds_wall':
      return 'The window selected first is taller than the other wall. Select the other one first.'
    case 'opening_overlap':
      return `Sliding them to the corner would overlap ${blockingKind}.`
    default:
      return 'These windows cannot be merged.'
  }
}

/**
 * Merge windows: with exactly two windows selected, one window across both, or one corner window
 * when they sit on two walls that meet. Windows ride their wall, so they have no floating group
 * menu, and this is where the wall merge's twin lives. Two that already wrap their corner get
 * Unwrap instead; two that cannot join, the reason.
 */
function MergeWindowsAction() {
  const selectedIds = useViewer((s) => s.selection.selectedIds)
  const nodes = useScene((s) => s.nodes)
  const readOnly = useScene((s) => s.readOnly)
  const unit = useViewer((s) => s.unit)
  const metricNotation = useViewer((s) => s.metricNotation)
  const offer = useMemo(() => windowMergeOffer(nodes, selectedIds), [nodes, selectedIds])
  if (!offer) return null
  if (offer.refusal?.code === 'windows_already_joined')
    return (
      <ActionButton
        className="basis-full whitespace-nowrap disabled:cursor-not-allowed disabled:opacity-40"
        disabled={readOnly}
        icon={<Split className="h-4 w-4" />}
        label="Unwrap the corner"
        onClick={() => {
          writeWindowChanges({
            create: null,
            updates: unwrapCorner(useScene.getState().nodes, selectedIds[0]!),
            remove: [],
          })
          triggerSFX('sfx:structure-build')
        }}
        title="Unwrap the corner: both windows stay, each framed at the corner"
      />
    )
  const { merge } = offer
  const note = offer.refusal
    ? mergeRefusalNote(offer.refusal, nodes, (meters) =>
        formatLinearMeasurement(meters, unit, metricNotation),
      )
    : null
  return (
    <>
      <ActionButton
        className="basis-full whitespace-nowrap disabled:cursor-not-allowed disabled:opacity-40"
        disabled={readOnly || !merge}
        icon={<Merge className="h-4 w-4" />}
        label="Merge windows"
        onClick={() => {
          if (!merge) return
          runAsSingleSceneHistoryStep(useScene, () =>
            writeWindowChanges({
              create: null,
              updates: Object.fromEntries(merge.changes.update.map(({ id, data }) => [id, data])),
              remove: merge.changes.delete,
            }),
          )
          triggerSFX('sfx:structure-build')
          useViewer.getState().setSelection({ selectedIds: merge.windowIds as AnyNodeId[] })
        }}
        title={
          note ??
          (merge?.kind === 'corner'
            ? 'Merge windows into a corner window: both take the height, sill and type of the one you selected first'
            : 'Merge windows into one across both: it keeps the type and style of the one you selected first')
        }
      />
      {note ? <p className="basis-full px-1 text-muted-foreground text-xs">{note}</p> : null}
    </>
  )
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
      <MergeWindowsAction />
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
        className="min-w-20 px-2 border-red-500/40 text-red-700 dark:text-red-200 hover:bg-red-500/15"
        icon={<Trash2 className="h-4 w-4 text-red-600 dark:text-red-400" />}
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

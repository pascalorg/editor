'use client'

import {
  type AnyNode,
  type AnyNodeId,
  buildUnitReport,
  getLevelDisplayName,
  type MessageDescriptor,
  type PascalI18n,
  UNIT_KINDS,
  type UnitKind,
  type UnitNode,
  unitWarnings,
  usePascalI18n,
  useScene,
} from '@pascal-app/core'
import {
  ActionButton,
  ActionGroup,
  displayRoomName,
  formatAreaLabel,
  PanelSection,
  PanelWrapper,
  triggerSFX,
} from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { Trash2, X } from 'lucide-react'
import { useCallback, useMemo } from 'react'
import { PanelSelect, PanelTextField } from '../shared/panel-fields'

const UNIT_KIND_LABELS: Record<UnitKind, MessageDescriptor> = {
  apartment: /* i18n */ { id: 'node.unit.kind.apartment', message: 'Apartment' },
  'hotel-room': /* i18n */ { id: 'node.unit.kind.hotelRoom', message: 'Hotel room' },
  commercial: /* i18n */ { id: 'node.unit.kind.commercial', message: 'Commercial' },
  common: /* i18n */ { id: 'node.unit.kind.common', message: 'Common' },
}

function ReportRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-2 rounded-md border border-border/50 bg-background/35 px-2.5 py-2 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span className="ml-auto font-mono font-medium text-foreground tabular-nums">{value}</span>
    </div>
  )
}

export default function UnitPanel({ node }: { node: UnitNode }) {
  const i18n = usePascalI18n()
  const nodes = useScene((state) => state.nodes)
  const updateNode = useScene((state) => state.updateNode)
  const setSelection = useViewer((state) => state.setSelection)
  const areaUnit = useViewer((state) => state.unit)
  const focusedUnitId = useViewer((state) => state.focusedUnitId)

  const report = useMemo(() => buildUnitReport(node, nodes), [node, nodes])
  const warnings = useMemo(() => unitWarnings(node, nodes), [node, nodes])

  const memberLevels = useMemo(() => {
    const ordinals = new Map<string, number>()
    for (const member of report.members) {
      if (member.levelId && member.levelOrdinal !== null) {
        ordinals.set(member.levelId, member.levelOrdinal)
      }
    }
    return [...ordinals.entries()]
      .sort((a, b) => a[1] - b[1])
      .map(([levelId]) => {
        const level = nodes[levelId as AnyNodeId]
        return { levelId, name: level?.type === 'level' ? getLevelDisplayName(level) : '' }
      })
  }, [nodes, report])

  const levelNameById = useMemo(
    () => new Map(memberLevels.map((level) => [level.levelId, level.name])),
    [memberLevels],
  )

  const levelSpanLabel = useMemo(() => {
    const names = memberLevels.map((level) => level.name).filter(Boolean)
    return names.length > 0 ? names.join(', ') : '—'
  }, [memberLevels])

  const update = useCallback(
    (patch: Partial<UnitNode>) => updateNode(node.id, patch),
    [node.id, updateNode],
  )

  const removeMember = useCallback(
    (zoneId: UnitNode['members'][number]) =>
      update({ members: node.members.filter((id) => id !== zoneId) }),
    [node.members, update],
  )

  const handleClose = useCallback(() => setSelection({ selectedIds: [] }), [setSelection])

  const handleDelete = useCallback(() => {
    triggerSFX('sfx:structure-delete')
    useScene.getState().deleteNode(node.id)
    setSelection({ selectedIds: [] })
  }, [node.id, setSelection])

  const warningMessages = warnings.map((warning) => {
    if (warning.code === 'non-adjacent-levels') {
      return i18n._({
        id: 'node.unit.panel.nonAdjacentLevels',
        message: 'Members sit on levels that are not adjacent.',
      })
    }
    return i18n._({ id: 'node.unit.panel.noZonesAssigned', message: 'No zones assigned yet.' })
  })

  return (
    <PanelWrapper
      icon="/icons/zone.webp"
      onClose={handleClose}
      title={node.name || i18n._({ id: 'node.unit.unitPanel.unit', message: 'Unit' })}
      width={320}
    >
      <PanelSection title={i18n._({ id: 'node.unit.unitPanel.unit', message: 'Unit' })}>
        <PanelTextField
          label={i18n._({ id: 'node.unit.unitPanel.name', message: 'Name' })}
          onCommit={(name) => update({ name })}
          value={node.name}
        />
        <PanelSelect
          label={i18n._({ id: 'node.unit.unitPanel.kind', message: 'Kind' })}
          onChange={(kind) => update({ kind: kind as UnitKind })}
          options={UNIT_KINDS.map((value) => ({ label: i18n._(UNIT_KIND_LABELS[value]), value }))}
          value={node.kind}
        />
        <label className="flex h-10 items-center justify-between gap-3 rounded-lg border border-border/50 bg-black/4 dark:bg-[#2C2C2E] px-3 text-sm">
          <span className="text-muted-foreground">
            {i18n._({ id: 'node.unit.unitPanel.color', message: 'Color' })}
          </span>
          <span className="flex items-center gap-2">
            <span className="font-mono text-muted-foreground text-xs">{node.color}</span>
            <input
              className="h-6 w-8 cursor-pointer rounded border border-border/50 bg-transparent"
              onChange={(event) => update({ color: event.target.value })}
              type="color"
              value={node.color}
            />
          </span>
        </label>
      </PanelSection>

      <PanelSection title={i18n._({ id: 'node.unit.unitPanel.members', message: 'Members' })}>
        {report.members.length === 0 ? (
          <p className="text-muted-foreground text-xs leading-snug">
            {i18n._({
              id: 'node.unit.unitPanel.noRoomsYetPickThisUnit',
              message:
                "No rooms yet. Pick this unit from a room's panel, or draw zones while it is focused.",
            })}
          </p>
        ) : (
          report.members.map((member) => (
            <div
              className="flex h-9 items-center gap-2 rounded-lg border border-border/50 bg-black/4 dark:bg-[#2C2C2E] px-3 text-xs"
              key={member.zoneId}
            >
              <span className="min-w-0 flex-1 truncate text-foreground">
                {member.name
                  ? displayRoomName(member.name, i18n)
                  : memberFallbackName(nodes, member.zoneId, i18n)}
              </span>
              <span className="shrink-0 truncate text-muted-foreground">
                {member.levelId ? levelNameById.get(member.levelId) : ''}
              </span>
              <span className="shrink-0 font-mono text-muted-foreground tabular-nums">
                {formatAreaLabel(member.areaM2, areaUnit, 1)}
              </span>
              <button
                aria-label={
                  member.name
                    ? i18n._({
                        id: 'node.unit.panel.removeMember',
                        message: 'Remove {name} from unit',
                        values: { name: displayRoomName(member.name, i18n) },
                      })
                    : i18n._({ id: 'node.unit.panel.removeZone', message: 'Remove zone from unit' })
                }
                className="shrink-0 rounded-full p-1 text-muted-foreground transition-colors hover:bg-black/8 dark:hover:bg-[#3e3e3e] hover:text-foreground"
                onClick={() => removeMember(member.zoneId)}
                type="button"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ))
        )}
        {warningMessages.length > 0 ? (
          <ul className="flex flex-col gap-1 text-amber-700 dark:text-amber-300 text-xs leading-snug">
            {warningMessages.map((message, index) => (
              <li key={warnings[index]?.code}>{message}</li>
            ))}
          </ul>
        ) : null}
      </PanelSection>

      <PanelSection title={i18n._({ id: 'node.unit.unitPanel.report', message: 'Report' })}>
        <ReportRow
          label={i18n._({ id: 'node.unit.unitPanel.members', message: 'Members' })}
          value={String(report.memberCount)}
        />
        <ReportRow
          label={i18n._({ id: 'node.unit.unitPanel.levels', message: 'Levels' })}
          value={levelSpanLabel}
        />
        <ReportRow
          label={i18n._({ id: 'node.unit.unitPanel.grossArea', message: 'Gross area' })}
          value={formatAreaLabel(report.grossAreaM2, areaUnit, 2)}
        />
      </PanelSection>

      <PanelSection title={i18n._({ id: 'node.unit.unitPanel.actions', message: 'Actions' })}>
        <ActionGroup>
          {focusedUnitId !== node.id && (
            <ActionButton
              className="rounded-full"
              label={i18n._({ id: 'node.unit.unitPanel.focus', message: 'Focus' })}
              onClick={() => useViewer.getState().setFocusedUnit(node.id)}
            />
          )}
          <ActionButton
            className="text-destructive hover:text-destructive"
            icon={<Trash2 className="h-3.5 w-3.5" />}
            label={i18n._({ id: 'node.unit.unitPanel.delete', message: 'Delete' })}
            onClick={handleDelete}
          />
        </ActionGroup>
      </PanelSection>
    </PanelWrapper>
  )
}

/** An unnamed member reads as what it is: a room, or another zone. */
function memberFallbackName(nodes: Record<string, AnyNode>, zoneId: string, i18n: PascalI18n) {
  const zone = nodes[zoneId]
  return zone?.type === 'zone' && zone.spaceRole === 'room'
    ? i18n._({ id: 'node.unit.panel.memberRoom', message: 'Room' })
    : i18n._({ id: 'node.unit.panel.memberZone', message: 'Zone' })
}

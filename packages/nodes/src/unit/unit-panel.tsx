'use client'

import {
  type AnyNodeId,
  buildUnitReport,
  getLevelDisplayName,
  UNIT_KINDS,
  type UnitKind,
  type UnitNode,
  unitWarnings,
  useScene,
} from '@pascal-app/core'
import {
  ActionButton,
  ActionGroup,
  formatAreaLabel,
  PanelSection,
  PanelWrapper,
  triggerSFX,
} from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { Trash2, X } from 'lucide-react'
import { useCallback, useMemo } from 'react'
import { PanelSelect, PanelTextField } from '../shared/panel-fields'

const UNIT_KIND_LABELS: Record<UnitKind, string> = {
  apartment: 'Apartment',
  'hotel-room': 'Hotel room',
  commercial: 'Commercial',
  common: 'Common',
}

const UNIT_KIND_OPTIONS = UNIT_KINDS.map((value) => ({ label: UNIT_KIND_LABELS[value], value }))

function ReportRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-2 rounded-md border border-border/50 bg-background/35 px-2.5 py-2 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span className="ml-auto font-mono font-medium text-foreground tabular-nums">{value}</span>
    </div>
  )
}

export default function UnitPanel({ node }: { node: UnitNode }) {
  const nodes = useScene((state) => state.nodes)
  const updateNode = useScene((state) => state.updateNode)
  const setSelection = useViewer((state) => state.setSelection)
  const areaUnit = useViewer((state) => state.unit)

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
    if (warning.code === 'shared-zone') {
      const zone = warning.zoneId ? nodes[warning.zoneId as AnyNodeId] : undefined
      const name = zone?.type === 'zone' && zone.name ? zone.name : 'A zone'
      return `${name} is also in another unit.`
    }
    if (warning.code === 'non-adjacent-levels') {
      return 'Members sit on levels that are not adjacent.'
    }
    return 'No zones assigned yet.'
  })

  return (
    <PanelWrapper
      icon="/icons/zone.webp"
      onClose={handleClose}
      title={node.name || 'Unit'}
      width={320}
    >
      <PanelSection title="Unit">
        <PanelTextField label="Name" onCommit={(name) => update({ name })} value={node.name} />
        <PanelSelect
          label="Kind"
          onChange={(kind) => update({ kind: kind as UnitKind })}
          options={UNIT_KIND_OPTIONS}
          value={node.kind}
        />
        <label className="flex h-10 items-center justify-between gap-3 rounded-lg border border-border/50 bg-[#2C2C2E] px-3 text-sm">
          <span className="text-muted-foreground">Color</span>
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

      <PanelSection title="Members">
        {report.members.length === 0 ? (
          <p className="text-muted-foreground text-xs leading-snug">
            No zones yet. Draw zones while this unit is active, or pick it from a zone's inspector.
          </p>
        ) : (
          report.members.map((member) => (
            <div
              className="flex h-9 items-center gap-2 rounded-lg border border-border/50 bg-[#2C2C2E] px-3 text-xs"
              key={member.zoneId}
            >
              <span className="min-w-0 flex-1 truncate text-foreground">
                {member.name || 'Zone'}
              </span>
              <span className="shrink-0 truncate text-muted-foreground">
                {member.levelId ? levelNameById.get(member.levelId) : ''}
              </span>
              <span className="shrink-0 font-mono text-muted-foreground tabular-nums">
                {formatAreaLabel(member.areaM2, areaUnit, 1)}
              </span>
              <button
                aria-label={`Remove ${member.name || 'zone'} from unit`}
                className="shrink-0 rounded-full p-1 text-muted-foreground transition-colors hover:bg-[#3e3e3e] hover:text-foreground"
                onClick={() => removeMember(member.zoneId)}
                type="button"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ))
        )}
        {warningMessages.length > 0 ? (
          <ul className="flex flex-col gap-1 text-amber-300 text-xs leading-snug">
            {warningMessages.map((message, index) => (
              <li key={`${warnings[index]?.code}-${warnings[index]?.zoneId ?? index}`}>
                {message}
              </li>
            ))}
          </ul>
        ) : null}
      </PanelSection>

      <PanelSection title="Report">
        <ReportRow label="Members" value={String(report.memberCount)} />
        <ReportRow label="Levels" value={levelSpanLabel} />
        <ReportRow label="Gross area" value={formatAreaLabel(report.grossAreaM2, areaUnit, 2)} />
      </PanelSection>

      <PanelSection title="Actions">
        <ActionGroup>
          <ActionButton
            className="text-destructive hover:text-destructive"
            icon={<Trash2 className="h-3.5 w-3.5" />}
            label="Delete"
            onClick={handleDelete}
          />
        </ActionGroup>
      </PanelSection>
    </PanelWrapper>
  )
}

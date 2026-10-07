'use client'

import {
  type AnyNode,
  buildUnitReport,
  type LevelNode,
  type UnitKind,
  type UnitNode,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { useMemo } from 'react'
import { getAreaUnitLabel, squareMetersToAreaUnit } from '../../lib/measurements'
import { cn } from '../../lib/utils'

const UNIT_KIND_LABELS: Record<UnitKind, string> = {
  apartment: 'Apartment',
  'hotel-room': 'Hotel room',
  commercial: 'Commercial',
  common: 'Common',
}

type UnitRow = {
  unit: UnitNode
  zoneCount: number
  areaM2: number
  /** Levels carrying member zones, lowest ordinal first. */
  levelIds: LevelNode['id'][]
}

/**
 * Read-only unit list shared by the editor preview and the published viewer.
 * Clicking a row focuses the unit and reveals a member floor through the shared
 * `useViewer.selection`; a second click clears the focus. Hidden without units.
 */
export function ViewerUnitsPanel({ nodes }: { nodes: Readonly<Record<string, AnyNode>> }) {
  const focusedUnitId = useViewer((s) => s.focusedUnitId)
  const areaUnit = useViewer((s) => s.unit)

  const rows = useMemo<UnitRow[]>(
    () =>
      Object.values(nodes)
        .filter((node): node is UnitNode => node.type === 'unit')
        .map((unit) => {
          const report = buildUnitReport(unit, nodes)
          const ordinals = new Map<LevelNode['id'], number>()
          for (const member of report.members) {
            if (member.levelId && member.levelOrdinal !== null) {
              ordinals.set(member.levelId, member.levelOrdinal)
            }
          }
          return {
            unit,
            zoneCount: report.memberCount,
            areaM2: report.grossAreaM2,
            levelIds: [...ordinals.entries()].sort((a, b) => a[1] - b[1]).map(([id]) => id),
          }
        }),
    [nodes],
  )

  if (rows.length === 0) return null

  return (
    <div className="corner-smooth pointer-events-auto flex w-48 flex-col overflow-hidden rounded-2xl border border-border/40 bg-background/95 py-1 shadow-elevation-4 backdrop-blur-xl">
      <span className="px-3 py-2 font-medium text-[10px] text-muted-foreground uppercase tracking-wider">
        Units
      </span>
      <div className="flex flex-col">
        {rows.map((row) => {
          const isFocused = row.unit.id === focusedUnitId
          const area = Math.round(squareMetersToAreaUnit(row.areaM2, areaUnit))
          const details = `${UNIT_KIND_LABELS[row.unit.kind]} · ${row.zoneCount} ${row.zoneCount === 1 ? 'zone' : 'zones'} · ${area} ${getAreaUnitLabel(areaUnit)}`
          return (
            <button
              className={cn(
                'group/row relative flex w-full cursor-pointer select-none items-center border-border/50 border-r border-r-transparent border-b px-3 py-1.5 text-sm transition-all duration-200',
                isFocused
                  ? 'border-r-3 border-r-white bg-accent/50 text-foreground'
                  : 'text-muted-foreground hover:bg-accent/30 hover:text-foreground',
              )}
              key={row.unit.id}
              onClick={() => {
                const viewer = useViewer.getState()
                if (isFocused) {
                  viewer.setFocusedUnit(null)
                  return
                }
                viewer.setFocusedUnit(row.unit.id)
                // Same rule as the editor: keep the current floor when it
                // already carries a member zone, otherwise reveal the lowest one.
                const current = viewer.selection.levelId
                const levelId =
                  current && row.levelIds.includes(current) ? current : row.levelIds[0]
                if (levelId && levelId !== current) viewer.setSelection({ levelId })
              }}
              type="button"
            >
              <div className="flex min-w-0 flex-1 items-center gap-2">
                <span className="flex h-4 w-4 shrink-0 items-center justify-center">
                  <span
                    className="h-2.5 w-2.5 rounded-full"
                    style={{ backgroundColor: row.unit.color }}
                  />
                </span>
                <div className="min-w-0 flex-1 text-left">
                  <div className="truncate">{row.unit.name}</div>
                  <div className="truncate text-[11px] text-muted-foreground">{details}</div>
                </div>
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}

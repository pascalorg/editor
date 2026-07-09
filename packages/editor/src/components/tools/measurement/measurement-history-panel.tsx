'use client'

import { DraftingCompass, Maximize2, Ruler, SquareDashed, Trash2, X } from 'lucide-react'
import { type ComponentType, type ReactNode, useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  angleBetweenMeasurements,
  formatAngleMeasurement,
  formatAreaMeasurement,
  formatLinearMeasurement,
  type LinearUnit,
} from '../../../lib/measurements'
import {
  distanceBetweenMeasurements,
  type MeasurementMode,
  useMeasurementTool,
} from '../../../store/use-measurement-tool'

type MeasurementHistoryPanelProps = {
  portal?: boolean
  unit: LinearUnit
}

type MeasurementHistoryRow = {
  id: string
  label: string
  value: string
  view: '2D' | '3D'
}

const MEASUREMENT_MODES: Array<{
  icon: ComponentType<{ className?: string }>
  id: MeasurementMode
  label: string
}> = [
  { icon: Ruler, id: 'distance', label: 'Length' },
  { icon: SquareDashed, id: 'area', label: 'Area' },
  { icon: Maximize2, id: 'perimeter', label: 'Perimeter' },
  { icon: DraftingCompass, id: 'angle', label: 'Angle' },
]

function historyViewLabel(view: '2d' | '3d'): '2D' | '3D' {
  return view === '2d' ? '2D' : '3D'
}

export function MeasurementHistoryPanel({
  portal = true,
  unit,
}: MeasurementHistoryPanelProps): ReactNode {
  const [mounted, setMounted] = useState(false)
  const segments = useMeasurementTool((state) => state.segments)
  const areas = useMeasurementTool((state) => state.areas)
  const perimeters = useMeasurementTool((state) => state.perimeters)
  const angles = useMeasurementTool((state) => state.angles)
  const mode = useMeasurementTool((state) => state.mode)
  const selectedId = useMeasurementTool((state) => state.selectedId)

  useEffect(() => {
    setMounted(true)
  }, [])

  const rows = useMemo<MeasurementHistoryRow[]>(
    () => [
      ...segments.map((segment, index) => ({
        id: segment.id,
        label: `Length ${index + 1}`,
        value: formatLinearMeasurement(
          segment.measuredDistanceMeters ?? distanceBetweenMeasurements(segment.start, segment.end),
          unit,
        ),
        view: historyViewLabel(segment.view),
      })),
      ...areas.map((area, index) => ({
        id: area.id,
        label: `Area ${index + 1}`,
        value: formatAreaMeasurement(area.areaSquareMeters, unit),
        view: historyViewLabel(area.view),
      })),
      ...perimeters.map((perimeter, index) => ({
        id: perimeter.id,
        label: `Perimeter ${index + 1}`,
        value: formatLinearMeasurement(perimeter.lengthMeters, unit),
        view: historyViewLabel(perimeter.view),
      })),
      ...angles.map((angle, index) => ({
        id: angle.id,
        label: `Angle ${index + 1}`,
        value: formatAngleMeasurement(
          angleBetweenMeasurements(angle.first, angle.vertex, angle.second),
        ),
        view: historyViewLabel(angle.view),
      })),
    ],
    [angles, areas, perimeters, segments, unit],
  )

  if (portal && !mounted) return null

  const panel = (
    <div className="pointer-events-auto fixed top-20 right-4 z-50 flex max-h-[calc(100dvh-7rem)] w-72 flex-col overflow-hidden rounded-lg border border-border/50 bg-background/95 text-foreground shadow-2xl backdrop-blur-xl">
      <div className="flex items-center justify-between border-border/50 border-b px-3 py-2">
        <div className="font-semibold text-sm">Measurements</div>
        <button
          aria-label="Clear measurements"
          className="grid h-7 w-7 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          onClick={() => useMeasurementTool.getState().clear()}
          title="Clear measurements"
          type="button"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>
      <div className="grid grid-cols-4 gap-1 border-border/50 border-b p-2">
        {MEASUREMENT_MODES.map((entry) => {
          const Icon = entry.icon
          const active = mode === entry.id
          return (
            <button
              aria-label={`${entry.label} measurement mode`}
              className={`grid h-9 place-items-center rounded-md transition-colors ${
                active ? 'bg-sky-500/15 text-sky-600' : 'text-muted-foreground hover:bg-muted'
              }`}
              key={entry.id}
              onClick={() => useMeasurementTool.getState().setMode(entry.id)}
              title={entry.label}
              type="button"
            >
              <Icon className="h-4 w-4" />
            </button>
          )
        })}
      </div>
      <div className="min-h-0 overflow-y-auto py-1">
        {rows.length === 0 ? (
          <div className="px-3 py-3 text-muted-foreground text-xs">No measurements yet</div>
        ) : null}
        {rows.map((row) => {
          const selected = selectedId === row.id
          return (
            <div
              className={`grid grid-cols-[1fr_auto_auto] items-center gap-2 px-2 py-1.5 text-sm ${
                selected ? 'bg-sky-500/12 text-foreground' : 'text-muted-foreground'
              }`}
              key={row.id}
            >
              <button
                className="min-w-0 rounded-md px-2 py-1 text-left transition-colors hover:bg-muted"
                onClick={() => useMeasurementTool.getState().selectMeasurement(row.id)}
                type="button"
              >
                <span className="block truncate font-medium">{row.label}</span>
                <span className="block text-[11px] text-muted-foreground">{row.view}</span>
              </button>
              <span className="font-mono text-xs">{row.value}</span>
              <button
                aria-label={`Delete ${row.label}`}
                className="grid h-7 w-7 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                onClick={() => useMeasurementTool.getState().removeMeasurement(row.id)}
                title={`Delete ${row.label}`}
                type="button"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )

  return portal ? createPortal(panel, document.body) : panel
}

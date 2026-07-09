'use client'

import { DraftingCompass, Link2, Maximize2, Ruler, SquareDashed, Trash2, X } from 'lucide-react'
import { type ComponentType, type ReactNode, useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  angleBetweenMeasurements,
  formatAngleMeasurement,
  formatAreaMeasurement,
  formatLinearMeasurement,
  getLinearUnitLabel,
  type LinearUnit,
  linearControlValueToMeters,
  metersToLinearUnit,
} from '../../../lib/measurements'
import {
  distanceBetweenMeasurements,
  type MeasurementDisplayPrecision,
  type MeasurementMode,
  type MeasurementSnapKind,
  useMeasurementTool,
} from '../../../store/use-measurement-tool'

type MeasurementHistoryPanelProps = {
  portal?: boolean
  unit: LinearUnit
}

type MeasurementHistoryRow = {
  id: string
  label: string
  lengthMeters?: number
  kind: 'length' | 'area' | 'perimeter' | 'angle'
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

const DISPLAY_PRECISIONS: Array<{
  id: MeasurementDisplayPrecision
  label: string
}> = [
  { id: 'coarse', label: '.0' },
  { id: 'standard', label: '.00' },
  { id: 'fine', label: '.000' },
]

const SNAP_CONTROLS: Array<{
  id: MeasurementSnapKind
  label: string
  title: string
}> = [
  { id: 'endpoint', label: 'End', title: 'Endpoint snaps' },
  { id: 'midpoint', label: 'Mid', title: 'Midpoint snaps' },
  { id: 'vertex', label: 'Vert', title: 'Vertex and corner snaps' },
  { id: 'edge', label: 'Edge', title: 'Edge projection snaps' },
  { id: 'intersection', label: 'Xing', title: 'Intersection snaps' },
  { id: 'center', label: 'Ctr', title: 'Center snaps' },
  { id: 'surface', label: 'Surf', title: 'Surface distance snaps' },
  { id: 'grid', label: 'Grid', title: 'Grid snaps' },
  { id: 'guide', label: 'Guide', title: 'Parallel and perpendicular guide snaps' },
  { id: 'measurement', label: 'Saved', title: 'Saved measurement snaps' },
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
  const draft = useMeasurementTool((state) => state.draft)
  const angleDraft = useMeasurementTool((state) => state.angleDraft)
  const mode = useMeasurementTool((state) => state.mode)
  const displayPrecision = useMeasurementTool((state) => state.displayPrecision)
  const continuousMeasurement = useMeasurementTool((state) => state.continuousMeasurement)
  const enabledSnapKinds = useMeasurementTool((state) => state.enabledSnapKinds)
  const selectedId = useMeasurementTool((state) => state.selectedId)
  const [draftAngleInputValue, setDraftAngleInputValue] = useState('')
  const [draftLengthInputValue, setDraftLengthInputValue] = useState('')
  const [lengthInputValue, setLengthInputValue] = useState('')

  useEffect(() => {
    setMounted(true)
  }, [])

  const rows = useMemo<MeasurementHistoryRow[]>(
    () => [
      ...segments.map((segment, index) => ({
        id: segment.id,
        kind: 'length' as const,
        label: `Length ${index + 1}`,
        lengthMeters:
          segment.measuredDistanceMeters ?? distanceBetweenMeasurements(segment.start, segment.end),
        value: formatLinearMeasurement(
          segment.measuredDistanceMeters ?? distanceBetweenMeasurements(segment.start, segment.end),
          unit,
          { precision: displayPrecision },
        ),
        view: historyViewLabel(segment.view),
      })),
      ...areas.map((area, index) => ({
        id: area.id,
        kind: 'area' as const,
        label: `Area ${index + 1}`,
        value: formatAreaMeasurement(area.areaSquareMeters, unit, { precision: displayPrecision }),
        view: historyViewLabel(area.view),
      })),
      ...perimeters.map((perimeter, index) => ({
        id: perimeter.id,
        kind: 'perimeter' as const,
        label: `Perimeter ${index + 1}`,
        value: formatLinearMeasurement(perimeter.lengthMeters, unit, {
          precision: displayPrecision,
        }),
        view: historyViewLabel(perimeter.view),
      })),
      ...angles.map((angle, index) => ({
        id: angle.id,
        kind: 'angle' as const,
        label: `Angle ${index + 1}`,
        value: formatAngleMeasurement(
          angleBetweenMeasurements(angle.first, angle.vertex, angle.second),
          { precision: displayPrecision },
        ),
        view: historyViewLabel(angle.view),
      })),
    ],
    [angles, areas, displayPrecision, perimeters, segments, unit],
  )

  const selectedLengthRow = rows.find(
    (row) => row.id === selectedId && row.kind === 'length' && row.lengthMeters,
  )
  const draftLengthMeters = draft?.end ? distanceBetweenMeasurements(draft.start, draft.end) : null
  const draftViewLabel = draft ? historyViewLabel(draft.view) : null
  const draftAngleDegrees =
    angleDraft?.vertex && angleDraft.second
      ? angleBetweenMeasurements(angleDraft.first, angleDraft.vertex, angleDraft.second)
      : null
  const draftAngleViewLabel = angleDraft ? historyViewLabel(angleDraft.view) : null

  useEffect(() => {
    if (!selectedLengthRow?.lengthMeters) {
      setLengthInputValue('')
      return
    }

    setLengthInputValue(metersToLinearUnit(selectedLengthRow.lengthMeters, unit).toFixed(3))
  }, [selectedLengthRow?.lengthMeters, unit])

  useEffect(() => {
    if (!draftLengthMeters) {
      setDraftLengthInputValue('')
      return
    }

    setDraftLengthInputValue(metersToLinearUnit(draftLengthMeters, unit).toFixed(3))
  }, [draftLengthMeters, unit])

  useEffect(() => {
    if (!draftAngleDegrees) {
      setDraftAngleInputValue('')
      return
    }

    setDraftAngleInputValue(draftAngleDegrees.toFixed(2))
  }, [draftAngleDegrees])

  const commitDraftLengthInput = () => {
    if (!draftLengthMeters) return
    const value = Number.parseFloat(draftLengthInputValue)
    if (!Number.isFinite(value)) {
      setDraftLengthInputValue(metersToLinearUnit(draftLengthMeters, unit).toFixed(3))
      return
    }

    useMeasurementTool
      .getState()
      .updateDraftLength(linearControlValueToMeters(value, unit, { minMeters: 0.001 }))
  }

  const commitDraftAngleInput = () => {
    if (!draftAngleDegrees) return
    const value = Number.parseFloat(draftAngleInputValue)
    if (!Number.isFinite(value)) {
      setDraftAngleInputValue(draftAngleDegrees.toFixed(2))
      return
    }

    useMeasurementTool.getState().updateAngleDegrees(value)
  }

  const commitLengthInput = () => {
    if (!selectedLengthRow) return
    const value = Number.parseFloat(lengthInputValue)
    if (!Number.isFinite(value)) {
      setLengthInputValue(metersToLinearUnit(selectedLengthRow.lengthMeters ?? 0, unit).toFixed(3))
      return
    }

    useMeasurementTool
      .getState()
      .updateSegmentLength(
        selectedLengthRow.id,
        linearControlValueToMeters(value, unit, { minMeters: 0.001 }),
      )
  }

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
      <div className="grid grid-cols-[repeat(3,minmax(0,1fr))_2.25rem] gap-1 border-border/50 border-b p-2">
        {DISPLAY_PRECISIONS.map((entry) => {
          const active = displayPrecision === entry.id
          return (
            <button
              aria-label={`${entry.id} measurement precision`}
              className={`h-8 rounded-md font-mono text-xs transition-colors ${
                active ? 'bg-sky-500/15 text-sky-600' : 'text-muted-foreground hover:bg-muted'
              }`}
              key={entry.id}
              onClick={() => useMeasurementTool.getState().setDisplayPrecision(entry.id)}
              title={`${entry.id} precision`}
              type="button"
            >
              {entry.label}
            </button>
          )
        })}
        <button
          aria-label="Toggle chained measurements"
          className={`grid h-8 place-items-center rounded-md transition-colors ${
            continuousMeasurement
              ? 'bg-sky-500/15 text-sky-600'
              : 'text-muted-foreground hover:bg-muted'
          }`}
          onClick={() =>
            useMeasurementTool.getState().setContinuousMeasurement(!continuousMeasurement)
          }
          title="Chained measurements"
          type="button"
        >
          <Link2 className="h-4 w-4" />
        </button>
      </div>
      <div className="border-border/50 border-b p-2">
        <div className="mb-1 grid grid-cols-3 gap-1">
          <button
            aria-label="Enable all measurement snap kinds"
            className="h-7 rounded-md px-1 font-medium text-[10px] text-muted-foreground transition-colors hover:bg-muted"
            onClick={() => useMeasurementTool.getState().setAllSnapKindsEnabled(true)}
            title="Enable all snaps"
            type="button"
          >
            All
          </button>
          <button
            aria-label="Disable all measurement snap kinds"
            className="h-7 rounded-md px-1 font-medium text-[10px] text-muted-foreground transition-colors hover:bg-muted"
            onClick={() => useMeasurementTool.getState().setAllSnapKindsEnabled(false)}
            title="Disable all snaps"
            type="button"
          >
            None
          </button>
          <button
            aria-label="Reset measurement snap kinds"
            className="h-7 rounded-md px-1 font-medium text-[10px] text-muted-foreground transition-colors hover:bg-muted"
            onClick={() => useMeasurementTool.getState().resetSnapKinds()}
            title="Reset snaps"
            type="button"
          >
            Reset
          </button>
        </div>
        <div className="grid grid-cols-5 gap-1">
          {SNAP_CONTROLS.map((entry) => {
            const active = enabledSnapKinds[entry.id]
            return (
              <button
                aria-label={`${active ? 'Disable' : 'Enable'} ${entry.title.toLowerCase()}`}
                className={`h-7 rounded-md px-1 font-medium text-[10px] transition-colors ${
                  active ? 'bg-sky-500/15 text-sky-600' : 'text-muted-foreground hover:bg-muted'
                }`}
                key={entry.id}
                onClick={() => useMeasurementTool.getState().setSnapKindEnabled(entry.id, !active)}
                title={entry.title}
                type="button"
              >
                {entry.label}
              </button>
            )
          })}
        </div>
      </div>
      {draftLengthMeters ? (
        <div className="grid grid-cols-[1fr_auto] items-center gap-2 border-border/50 border-b px-3 py-2">
          <div className="min-w-0">
            <div className="truncate font-medium text-xs">Active length</div>
            <div className="text-[11px] text-muted-foreground">{draftViewLabel}</div>
          </div>
          <div className="flex items-center gap-1">
            <input
              aria-label="Edit active measurement length"
              className="h-7 w-20 rounded-md border border-border/60 bg-background px-2 text-right font-mono text-xs outline-none transition-colors focus:border-sky-500"
              inputMode="decimal"
              min="0"
              onBlur={commitDraftLengthInput}
              onChange={(event) => setDraftLengthInputValue(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.currentTarget.blur()
                }
                if (event.key === 'Escape') {
                  setDraftLengthInputValue(metersToLinearUnit(draftLengthMeters, unit).toFixed(3))
                  event.currentTarget.blur()
                }
              }}
              type="number"
              value={draftLengthInputValue}
            />
            <span className="font-mono text-[11px] text-muted-foreground">
              {getLinearUnitLabel(unit)}
            </span>
          </div>
        </div>
      ) : null}
      {draftAngleDegrees ? (
        <div className="grid grid-cols-[1fr_auto] items-center gap-2 border-border/50 border-b px-3 py-2">
          <div className="min-w-0">
            <div className="truncate font-medium text-xs">Active angle</div>
            <div className="text-[11px] text-muted-foreground">{draftAngleViewLabel}</div>
          </div>
          <div className="flex items-center gap-1">
            <input
              aria-label="Edit active measurement angle"
              className="h-7 w-20 rounded-md border border-border/60 bg-background px-2 text-right font-mono text-xs outline-none transition-colors focus:border-sky-500"
              inputMode="decimal"
              max="359.999"
              min="0"
              onBlur={commitDraftAngleInput}
              onChange={(event) => setDraftAngleInputValue(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.currentTarget.blur()
                }
                if (event.key === 'Escape') {
                  setDraftAngleInputValue(draftAngleDegrees.toFixed(2))
                  event.currentTarget.blur()
                }
              }}
              type="number"
              value={draftAngleInputValue}
            />
            <span className="font-mono text-[11px] text-muted-foreground">deg</span>
          </div>
        </div>
      ) : null}
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
              {selected && row.kind === 'length' ? (
                <div className="flex items-center gap-1">
                  <input
                    aria-label={`Edit ${row.label}`}
                    className="h-7 w-20 rounded-md border border-border/60 bg-background px-2 text-right font-mono text-xs outline-none transition-colors focus:border-sky-500"
                    inputMode="decimal"
                    min="0"
                    onBlur={commitLengthInput}
                    onChange={(event) => setLengthInputValue(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.currentTarget.blur()
                      }
                      if (event.key === 'Escape') {
                        setLengthInputValue(
                          metersToLinearUnit(row.lengthMeters ?? 0, unit).toFixed(3),
                        )
                        event.currentTarget.blur()
                      }
                    }}
                    type="number"
                    value={lengthInputValue}
                  />
                  <span className="font-mono text-[11px] text-muted-foreground">
                    {getLinearUnitLabel(unit)}
                  </span>
                </div>
              ) : (
                <span className="font-mono text-xs">{row.value}</span>
              )}
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

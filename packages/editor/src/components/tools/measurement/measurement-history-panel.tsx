'use client'

import {
  ChevronDown,
  DraftingCompass,
  Link2,
  Maximize2,
  Ruler,
  SquareDashed,
  Trash2,
  X,
} from 'lucide-react'
import { type ComponentType, type ReactNode, useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { lingoUnitSpec, parseMeasurement } from '../../../lib/measurement-parser'
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
  DEFAULT_MEASUREMENT_SNAP_SETTINGS,
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
  angleDegrees?: number
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
  title: string
}> = [
  { id: 'coarse', label: '0.1', title: '1 decimal place' },
  { id: 'standard', label: '0.01', title: '2 decimal places' },
  { id: 'fine', label: '0.001', title: '3 decimal places' },
]

const nextDisplayPrecision: Record<MeasurementDisplayPrecision, MeasurementDisplayPrecision> = {
  coarse: 'standard',
  standard: 'fine',
  fine: 'coarse',
}

export function parseLinearMeasurementInputToMeters(raw: string, unit: LinearUnit): number | null {
  const spec = lingoUnitSpec('m')
  const parsed = spec
    ? parseMeasurement(raw, spec, {
        bareUnit: unit === 'imperial' ? 'ft' : 'm',
        system: unit === 'imperial' ? 'us' : 'metric',
      })
    : null
  if (parsed !== null) return Math.max(parsed, 0.001)

  const value = Number.parseFloat(raw)
  if (!Number.isFinite(value)) return null
  return linearControlValueToMeters(value, unit, { minMeters: 0.001 })
}

const SNAP_CONTROLS: Array<{
  group: 'Drawing helpers' | 'Existing' | 'Object geometry'
  id: MeasurementSnapKind
  label: string
  title: string
}> = [
  {
    group: 'Object geometry',
    id: 'endpoint',
    label: 'Endpoints',
    title: 'Endpoint snaps',
  },
  {
    group: 'Object geometry',
    id: 'midpoint',
    label: 'Midpoints',
    title: 'Midpoint snaps',
  },
  {
    group: 'Object geometry',
    id: 'vertex',
    label: 'Corners',
    title: 'Vertex and corner snaps',
  },
  {
    group: 'Object geometry',
    id: 'edge',
    label: 'Edges',
    title: 'Edge projection snaps',
  },
  {
    group: 'Object geometry',
    id: 'intersection',
    label: 'Intersections',
    title: 'Intersection snaps',
  },
  {
    group: 'Object geometry',
    id: 'center',
    label: 'Centers',
    title: 'Center snaps',
  },
  {
    group: 'Drawing helpers',
    id: 'grid',
    label: 'Grid',
    title: 'Grid snaps',
  },
  {
    group: 'Drawing helpers',
    id: 'guide',
    label: 'Guides',
    title: 'Parallel and perpendicular guide snaps',
  },
  {
    group: 'Existing',
    id: 'surface',
    label: 'Surfaces',
    title: 'Surface distance snaps',
  },
  {
    group: 'Existing',
    id: 'measurement',
    label: 'Measurements',
    title: 'Saved measurement snaps',
  },
]

const SNAP_GROUPS: Array<(typeof SNAP_CONTROLS)[number]['group']> = [
  'Object geometry',
  'Drawing helpers',
  'Existing',
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
  const [angleInputValue, setAngleInputValue] = useState('')
  const [draftAngleInputValue, setDraftAngleInputValue] = useState('')
  const [draftLengthInputValue, setDraftLengthInputValue] = useState('')
  const [lengthInputValue, setLengthInputValue] = useState('')
  const [snapOptionsOpen, setSnapOptionsOpen] = useState(false)

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
        angleDegrees: angleBetweenMeasurements(angle.first, angle.vertex, angle.second),
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
  const selectedAngleRow = rows.find(
    (row) => row.id === selectedId && row.kind === 'angle' && row.angleDegrees,
  )
  const draftLengthMeters = draft?.end ? distanceBetweenMeasurements(draft.start, draft.end) : null
  const draftViewLabel = draft ? historyViewLabel(draft.view) : null
  const draftAngleRadians =
    angleDraft?.vertex && angleDraft.second
      ? angleBetweenMeasurements(angleDraft.first, angleDraft.vertex, angleDraft.second)
      : null
  const draftAngleViewLabel = angleDraft ? historyViewLabel(angleDraft.view) : null
  const allSnapKindsEnabled = SNAP_CONTROLS.every((entry) => enabledSnapKinds[entry.id])
  const noSnapKindsEnabled = SNAP_CONTROLS.every((entry) => !enabledSnapKinds[entry.id])
  const defaultSnapKindsEnabled = SNAP_CONTROLS.every(
    (entry) => enabledSnapKinds[entry.id] === DEFAULT_MEASUREMENT_SNAP_SETTINGS[entry.id],
  )

  useEffect(() => {
    if (!selectedLengthRow?.lengthMeters) {
      setLengthInputValue('')
      return
    }

    setLengthInputValue(metersToLinearUnit(selectedLengthRow.lengthMeters, unit).toFixed(3))
  }, [selectedLengthRow?.lengthMeters, unit])

  useEffect(() => {
    if (!selectedAngleRow?.angleDegrees) {
      setAngleInputValue('')
      return
    }

    setAngleInputValue(((selectedAngleRow.angleDegrees * 180) / Math.PI).toFixed(2))
  }, [selectedAngleRow?.angleDegrees])

  useEffect(() => {
    if (!draftLengthMeters) {
      setDraftLengthInputValue('')
      return
    }

    setDraftLengthInputValue(metersToLinearUnit(draftLengthMeters, unit).toFixed(3))
  }, [draftLengthMeters, unit])

  useEffect(() => {
    if (!draftAngleRadians) {
      setDraftAngleInputValue('')
      return
    }

    setDraftAngleInputValue(((draftAngleRadians * 180) / Math.PI).toFixed(2))
  }, [draftAngleRadians])

  const commitDraftLengthInput = () => {
    if (!draftLengthMeters) return
    const value = parseLinearMeasurementInputToMeters(draftLengthInputValue, unit)
    if (value === null) {
      setDraftLengthInputValue(metersToLinearUnit(draftLengthMeters, unit).toFixed(3))
      return
    }

    useMeasurementTool.getState().updateDraftLength(value)
  }

  const commitDraftAngleInput = () => {
    if (!draftAngleRadians) return
    const value = Number.parseFloat(draftAngleInputValue)
    if (!Number.isFinite(value)) {
      setDraftAngleInputValue(((draftAngleRadians * 180) / Math.PI).toFixed(2))
      return
    }

    useMeasurementTool.getState().updateAngleDegrees(value)
  }

  const commitLengthInput = () => {
    if (!selectedLengthRow) return
    const value = parseLinearMeasurementInputToMeters(lengthInputValue, unit)
    if (value === null) {
      setLengthInputValue(metersToLinearUnit(selectedLengthRow.lengthMeters ?? 0, unit).toFixed(3))
      return
    }

    useMeasurementTool.getState().updateSegmentLength(selectedLengthRow.id, value)
  }

  const commitAngleInput = () => {
    if (!selectedAngleRow?.angleDegrees) return
    const value = Number.parseFloat(angleInputValue)
    if (!Number.isFinite(value)) {
      setAngleInputValue(((selectedAngleRow.angleDegrees * 180) / Math.PI).toFixed(2))
      return
    }

    useMeasurementTool.getState().updateAngleMeasurementDegrees(selectedAngleRow.id, value)
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
              type="text"
              value={draftLengthInputValue}
            />
            <span className="font-mono text-[11px] text-muted-foreground">
              {getLinearUnitLabel(unit)}
            </span>
          </div>
        </div>
      ) : null}
      <div className="grid gap-1.5 border-border/50 border-b p-2">
        <div className="grid grid-cols-[1fr_auto] items-center gap-2">
          <div className="min-w-0 font-medium text-xs">Precision</div>
          <button
            aria-label="Cycle measurement display precision"
            className="h-8 min-w-20 rounded-md border border-border/60 bg-muted/40 px-3 text-center font-mono text-xs transition-colors hover:bg-muted"
            onClick={() =>
              useMeasurementTool
                .getState()
                .setDisplayPrecision(nextDisplayPrecision[displayPrecision])
            }
            title={DISPLAY_PRECISIONS.find((entry) => entry.id === displayPrecision)?.title}
            type="button"
          >
            {DISPLAY_PRECISIONS.find((entry) => entry.id === displayPrecision)?.label}
          </button>
        </div>
        <div className="grid grid-cols-[1fr_auto] items-center gap-2">
          <div className="min-w-0 font-medium text-xs">Chained measurements</div>
          <button
            aria-pressed={continuousMeasurement}
            aria-label={`${continuousMeasurement ? 'Disable' : 'Enable'} chained measurements`}
            className={`flex h-8 min-w-20 items-center justify-center gap-1.5 rounded-md border border-border/60 px-3 font-medium text-xs transition-colors ${
              continuousMeasurement
                ? 'bg-sky-500/15 text-sky-600'
                : 'bg-muted/40 text-muted-foreground hover:bg-muted hover:text-foreground'
            }`}
            onClick={() =>
              useMeasurementTool.getState().setContinuousMeasurement(!continuousMeasurement)
            }
            title="Chained measurements"
            type="button"
          >
            <Link2 className="h-3.5 w-3.5" />
            {continuousMeasurement ? 'On' : 'Off'}
          </button>
        </div>
      </div>
      {draftAngleRadians ? (
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
                  setDraftAngleInputValue(((draftAngleRadians * 180) / Math.PI).toFixed(2))
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
      <div className="min-h-0 flex-1 overflow-y-auto py-1">
        <div className="px-3 pt-1 pb-1 font-medium text-[10px] text-muted-foreground uppercase">
          History
        </div>
        {rows.length === 0 ? (
          <div className="px-3 pt-1 pb-3 text-muted-foreground text-xs">No measurements yet</div>
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
                    type="text"
                    value={lengthInputValue}
                  />
                  <span className="font-mono text-[11px] text-muted-foreground">
                    {getLinearUnitLabel(unit)}
                  </span>
                </div>
              ) : selected && row.kind === 'angle' ? (
                <div className="flex items-center gap-1">
                  <input
                    aria-label={`Edit ${row.label}`}
                    className="h-7 w-20 rounded-md border border-border/60 bg-background px-2 text-right font-mono text-xs outline-none transition-colors focus:border-sky-500"
                    inputMode="decimal"
                    max="359.999"
                    min="0"
                    onBlur={commitAngleInput}
                    onChange={(event) => setAngleInputValue(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.currentTarget.blur()
                      }
                      if (event.key === 'Escape') {
                        setAngleInputValue(
                          row.angleDegrees ? ((row.angleDegrees * 180) / Math.PI).toFixed(2) : '',
                        )
                        event.currentTarget.blur()
                      }
                    }}
                    type="number"
                    value={angleInputValue}
                  />
                  <span className="font-mono text-[11px] text-muted-foreground">deg</span>
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
      <div className="border-border/50 border-t">
        <div
          className={`group/section flex h-10 items-center gap-2 px-3 transition-all duration-200 ${
            snapOptionsOpen ? 'bg-accent/50' : 'hover:bg-accent/30'
          }`}
        >
          <button
            aria-expanded={snapOptionsOpen}
            className={`min-w-0 flex-1 text-left font-medium text-sm transition-colors ${
              snapOptionsOpen ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'
            }`}
            onClick={() => setSnapOptionsOpen((open) => !open)}
            type="button"
          >
            <span className="truncate">Snapping options</span>
          </button>
          <button
            aria-expanded={snapOptionsOpen}
            aria-label={snapOptionsOpen ? 'Collapse snapping options' : 'Expand snapping options'}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-[#3e3e3e] hover:text-foreground"
            onClick={() => setSnapOptionsOpen((open) => !open)}
            type="button"
          >
            <ChevronDown
              className={`h-4 w-4 transition-transform duration-200 ${
                snapOptionsOpen
                  ? 'rotate-180 text-foreground'
                  : 'rotate-0 opacity-0 group-hover/section:opacity-100'
              }`}
            />
          </button>
        </div>
        {snapOptionsOpen ? (
          <div className="grid gap-2 px-3 pt-2 pb-3">
            <div className="grid grid-cols-3 overflow-hidden rounded-md bg-[#2C2C2E]">
              <button
                aria-label="Enable all measurement snap kinds"
                aria-pressed={allSnapKindsEnabled}
                className={`h-7 px-2 font-medium text-[10px] transition-colors ${
                  allSnapKindsEnabled
                    ? 'bg-[#3e3e3e] text-foreground ring-1 ring-border/50'
                    : 'text-muted-foreground hover:bg-[#3e3e3e] hover:text-foreground'
                }`}
                onClick={() => useMeasurementTool.getState().setAllSnapKindsEnabled(true)}
                title="Enable all snaps"
                type="button"
              >
                All
              </button>
              <button
                aria-label="Disable all measurement snap kinds"
                aria-pressed={noSnapKindsEnabled}
                className={`h-7 border-border/50 border-l px-2 font-medium text-[10px] transition-colors ${
                  noSnapKindsEnabled
                    ? 'bg-[#3e3e3e] text-foreground ring-1 ring-border/50'
                    : 'text-muted-foreground hover:bg-[#3e3e3e] hover:text-foreground'
                }`}
                onClick={() => useMeasurementTool.getState().setAllSnapKindsEnabled(false)}
                title="Disable all snaps"
                type="button"
              >
                None
              </button>
              <button
                aria-label="Reset measurement snap kinds"
                aria-pressed={defaultSnapKindsEnabled && !allSnapKindsEnabled}
                className={`h-7 border-border/50 border-l px-2 font-medium text-[10px] transition-colors ${
                  defaultSnapKindsEnabled && !allSnapKindsEnabled
                    ? 'bg-[#3e3e3e] text-foreground ring-1 ring-border/50'
                    : 'text-muted-foreground hover:bg-[#3e3e3e] hover:text-foreground'
                }`}
                onClick={() => useMeasurementTool.getState().resetSnapKinds()}
                title="Reset snaps"
                type="button"
              >
                Reset
              </button>
            </div>
            {SNAP_GROUPS.map((group) => (
              <div className="grid gap-1" key={group}>
                <div className="px-1 font-medium text-[10px] text-muted-foreground uppercase">
                  {group}
                </div>
                <div className="grid grid-cols-2 gap-1">
                  {SNAP_CONTROLS.filter((entry) => entry.group === group).map((entry) => {
                    const active = enabledSnapKinds[entry.id]
                    return (
                      <button
                        aria-label={`${active ? 'Disable' : 'Enable'} ${entry.title.toLowerCase()}`}
                        aria-pressed={active}
                        className={`flex h-8 items-center justify-between rounded-md px-2 font-medium text-[11px] transition-colors ${
                          active
                            ? 'bg-[#3e3e3e] text-foreground ring-1 ring-border/50'
                            : 'bg-[#2C2C2E] text-muted-foreground hover:bg-[#3e3e3e] hover:text-foreground'
                        }`}
                        key={entry.id}
                        onClick={() =>
                          useMeasurementTool.getState().setSnapKindEnabled(entry.id, !active)
                        }
                        title={entry.title}
                        type="button"
                      >
                        <span className="truncate">{entry.label}</span>
                        <span
                          aria-hidden="true"
                          className={`ml-2 h-1.5 w-1.5 shrink-0 rounded-full ${
                            active ? 'bg-sky-500' : 'bg-muted-foreground/30'
                          }`}
                        />
                      </button>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  )

  return portal ? createPortal(panel, document.body) : panel
}

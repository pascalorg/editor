'use client'

import {
  DRYWALL_THICKNESSES,
  FRAMING_SPACINGS,
  type InsulationKind,
  type InteriorFinishKind,
  LUMBER_DEPTH,
  type NominalLumber,
  PANEL_THICKNESSES,
  type PanelKind,
  PLASTER_THICKNESS,
  WOOD_PLANK_THICKNESS,
} from '@pascal-app/core'
import { SelectControl } from '@pascal-app/editor'
import { useState } from 'react'
import { formatLayerThickness, parseLayerThickness } from './layer-thickness'

type LinearUnit = 'metric' | 'imperial'

const key = (value: number) => value.toFixed(6)

/**
 * A select over standard sizes (panel thicknesses, spacings). A stored value
 * off the list stays selectable, so a scene written elsewhere reads back as
 * it is.
 */
export function SizeSelect({
  label,
  value,
  sizes,
  format,
  onChange,
}: {
  label: string
  value: number
  sizes: readonly number[]
  format: (value: number) => string
  onChange: (value: number) => void
}) {
  const listed = sizes.some((size) => Math.abs(size - value) < 1e-6)
  const choices = listed ? sizes : [value, ...sizes]
  const current = choices.find((size) => Math.abs(size - value) < 1e-6) ?? value
  return (
    <SelectControl
      label={label}
      onChange={(next) => {
        const picked = choices.find((size) => key(size) === next)
        if (picked !== undefined) onChange(picked)
      }}
      options={choices.map((size) => ({ label: format(size), value: key(size) }))}
      value={key(current)}
    />
  )
}

/** A free thickness, typed as `5/8`, `3 1/2"` or `90mm`; a bare number is inches or millimetres. */
export function ThicknessField({
  label,
  metres,
  onCommit,
  unit,
}: {
  label: string
  metres: number
  onCommit: (metres: number) => void
  unit: LinearUnit
}) {
  const [draft, setDraft] = useState<string | null>(null)
  return (
    <label className="flex h-10 w-full items-center justify-between gap-2 rounded-lg border border-border/50 bg-black/4 px-3 text-sm dark:bg-[#2C2C2E]">
      <span className="select-none text-muted-foreground">{label}</span>
      <input
        className="w-24 bg-transparent text-right text-foreground outline-none"
        onBlur={() => {
          if (draft !== null) {
            const parsed = parseLayerThickness(draft, unit)
            if (parsed !== null) onCommit(parsed)
          }
          setDraft(null)
        }}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur()
          if (event.key === 'Escape') {
            setDraft(null)
            event.currentTarget.blur()
          }
        }}
        spellCheck={false}
        value={draft ?? formatLayerThickness(metres, unit)}
      />
    </label>
  )
}

export function BuildUpReadout({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-2 px-2 py-1">
      <span className="font-medium text-[10px] text-muted-foreground uppercase tracking-wider">
        {label}
      </span>
      <span className="truncate text-[11px] text-muted-foreground tabular-nums">{value}</span>
    </div>
  )
}

/** A spacing on centre, as the viewer's unit names it: `16" o.c.` or `406 mm o.c.`. */
export function formatSpacing(metres: number, unit: LinearUnit): string {
  if (unit === 'imperial') return `${formatLayerThickness(metres, unit)} o.c.`
  return `${Math.round(metres * 1000)} mm o.c.`
}

export const NONE = 'none'
const INCH = 0.0254

const PANEL_OPTIONS: { label: string; value: PanelKind | typeof NONE }[] = [
  { label: 'OSB', value: 'osb' },
  { label: 'Plywood', value: 'plywood' },
]
const OPTIONAL_PANEL_OPTIONS: typeof PANEL_OPTIONS = [
  { label: 'None', value: NONE },
  ...PANEL_OPTIONS,
]

const LUMBER_OPTIONS: { label: string; value: NominalLumber }[] = (
  Object.keys(LUMBER_DEPTH) as NominalLumber[]
).map((size) => ({ label: size, value: size }))

const INSULATION_OPTIONS: { label: string; value: InsulationKind | typeof NONE }[] = [
  { label: 'None', value: NONE },
  { label: 'Batt', value: 'batt' },
  { label: 'Blown', value: 'blown' },
  { label: 'Rigid board', value: 'rigid' },
]

const FINISH_OPTIONS: { label: string; value: InteriorFinishKind | typeof NONE }[] = [
  { label: 'None', value: NONE },
  { label: 'Drywall', value: 'drywall' },
  { label: 'Plaster', value: 'plaster' },
  { label: 'Wood plank', value: 'wood-plank' },
]

const FINISH_THICKNESS: Record<InteriorFinishKind, number> = {
  drywall: DRYWALL_THICKNESSES[0]!,
  plaster: PLASTER_THICKNESS,
  'wood-plank': WOOD_PLANK_THICKNESS,
}

/** `base` with `change` applied and no longer a preset; a layer set to `undefined` goes. */
export function editedBuildUp<T extends { presetId?: string }>(base: T, change: Partial<T>): T {
  const next: Record<string, unknown> = { ...base, ...change }
  delete next.presetId
  for (const field of Object.keys(next)) if (next[field] === undefined) delete next[field]
  return next as T
}

export function FramingSizeFields({
  framing,
  onChange,
  sizeLabel,
  unit,
}: {
  framing: { size: NominalLumber; spacing: number }
  onChange: (change: { size?: NominalLumber; spacing?: number }) => void
  sizeLabel: string
  unit: LinearUnit
}) {
  return (
    <>
      <SelectControl
        label={sizeLabel}
        onChange={(size) => onChange({ size })}
        options={LUMBER_OPTIONS}
        value={framing.size}
      />
      <SizeSelect
        format={(value) => formatSpacing(value, unit)}
        label="Spacing"
        onChange={(spacing) => onChange({ spacing })}
        sizes={FRAMING_SPACINGS}
        value={framing.spacing}
      />
    </>
  )
}

/** A structural panel; with `optional`, None takes it out and a new one is `added`. */
export function PanelFields({
  added = PANEL_THICKNESSES[0]!,
  label,
  layer,
  onChange,
  optional = false,
  unit,
}: {
  added?: number
  label: string
  layer: { kind: PanelKind; thickness: number } | undefined
  onChange: (layer: { kind: PanelKind; thickness: number } | undefined) => void
  optional?: boolean
  unit: LinearUnit
}) {
  return (
    <>
      <SelectControl
        label={label}
        onChange={(kind) =>
          onChange(kind === NONE ? undefined : { thickness: layer?.thickness ?? added, kind })
        }
        options={optional ? OPTIONAL_PANEL_OPTIONS : PANEL_OPTIONS}
        value={layer?.kind ?? NONE}
      />
      {layer && (
        <SizeSelect
          format={(value) => formatLayerThickness(value, unit)}
          label={`${label} thickness`}
          onChange={(thickness) => onChange({ ...layer, thickness })}
          sizes={PANEL_THICKNESSES}
          value={layer.thickness}
        />
      )}
    </>
  )
}

/** A new insulation layer is cavity fill as deep as the framing, or 2 in of rigid board. */
export function InsulationFields({
  framingDepth,
  layer,
  onChange,
  unit,
}: {
  framingDepth: number
  layer: { kind: InsulationKind; thickness: number } | undefined
  onChange: (layer: { kind: InsulationKind; thickness: number } | undefined) => void
  unit: LinearUnit
}) {
  return (
    <>
      <SelectControl
        label="Insulation"
        onChange={(kind) =>
          onChange(
            kind === NONE
              ? undefined
              : { kind, thickness: kind === 'rigid' ? 2 * INCH : framingDepth },
          )
        }
        options={INSULATION_OPTIONS}
        value={layer?.kind ?? NONE}
      />
      {layer && (
        <ThicknessField
          label="Insulation thickness"
          metres={layer.thickness}
          onCommit={(thickness) => onChange({ ...layer, thickness })}
          unit={unit}
        />
      )}
    </>
  )
}

export function FinishFields({
  label,
  layer,
  onChange,
  unit,
}: {
  label: string
  layer: { kind: InteriorFinishKind; thickness: number } | undefined
  onChange: (layer: { kind: InteriorFinishKind; thickness: number } | undefined) => void
  unit: LinearUnit
}) {
  return (
    <>
      <SelectControl
        label={label}
        onChange={(kind) =>
          onChange(kind === NONE ? undefined : { kind, thickness: FINISH_THICKNESS[kind] })
        }
        options={FINISH_OPTIONS}
        value={layer?.kind ?? NONE}
      />
      {layer?.kind === 'drywall' && (
        <SizeSelect
          format={(value) => formatLayerThickness(value, unit)}
          label="Drywall thickness"
          onChange={(thickness) => onChange({ kind: 'drywall', thickness })}
          sizes={DRYWALL_THICKNESSES}
          value={layer.thickness}
        />
      )}
    </>
  )
}

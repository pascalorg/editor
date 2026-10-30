'use client'

import {
  DRYWALL_THICKNESSES,
  FRAMING_SPACINGS,
  type InsulationKind,
  type InteriorFinishKind,
  LUMBER_DEPTH,
  type MessageDescriptor,
  type NominalLumber,
  PANEL_THICKNESSES,
  type PanelKind,
  type PascalI18n,
  PLASTER_THICKNESS,
  usePascalI18n,
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
export function formatSpacing(metres: number, unit: LinearUnit, i18n: PascalI18n): string {
  const spacing =
    unit === 'imperial' ? formatLayerThickness(metres, unit) : `${Math.round(metres * 1000)} mm`
  return i18n._({
    id: 'node.shared.buildUpControls.spacingOC',
    message: '{spacing} o.c.',
    comment: 'A framing spacing on centre (centre of one member to the next), e.g. 16" o.c.',
    values: { spacing },
  })
}

export const NONE = 'none'
const INCH = 0.0254

const NONE_LABEL: MessageDescriptor = /* i18n */ {
  id: 'node.shared.buildUpControls.none',
  message: 'None',
}

/** What each panel, insulation and finish kind is called. */
export const LAYER_KIND_LABELS: Record<
  PanelKind | InsulationKind | InteriorFinishKind,
  MessageDescriptor
> = {
  osb: /* i18n */ { id: 'node.shared.buildUpControls.osb', message: 'OSB' },
  plywood: /* i18n */ { id: 'node.shared.buildUpControls.plywood', message: 'Plywood' },
  batt: /* i18n */ { id: 'node.shared.buildUpControls.batt', message: 'Batt' },
  blown: /* i18n */ { id: 'node.shared.buildUpControls.blown', message: 'Blown' },
  rigid: /* i18n */ { id: 'node.shared.buildUpControls.rigidBoard', message: 'Rigid board' },
  drywall: /* i18n */ { id: 'node.shared.buildUpControls.drywall', message: 'Drywall' },
  plaster: /* i18n */ { id: 'node.shared.buildUpControls.plaster', message: 'Plaster' },
  'wood-plank': /* i18n */ { id: 'node.shared.buildUpControls.woodPlank', message: 'Wood plank' },
}

const PANEL_OPTIONS: { label: MessageDescriptor; value: PanelKind | typeof NONE }[] = [
  { label: LAYER_KIND_LABELS.osb, value: 'osb' },
  { label: LAYER_KIND_LABELS.plywood, value: 'plywood' },
]
const OPTIONAL_PANEL_OPTIONS: typeof PANEL_OPTIONS = [
  { label: NONE_LABEL, value: NONE },
  ...PANEL_OPTIONS,
]

const LUMBER_OPTIONS: { label: string; value: NominalLumber }[] = (
  Object.keys(LUMBER_DEPTH) as NominalLumber[]
).map((size) => ({ label: size, value: size }))

const INSULATION_OPTIONS: { label: MessageDescriptor; value: InsulationKind | typeof NONE }[] = [
  { label: NONE_LABEL, value: NONE },
  { label: LAYER_KIND_LABELS.batt, value: 'batt' },
  { label: LAYER_KIND_LABELS.blown, value: 'blown' },
  { label: LAYER_KIND_LABELS.rigid, value: 'rigid' },
]

const FINISH_OPTIONS: { label: MessageDescriptor; value: InteriorFinishKind | typeof NONE }[] = [
  { label: NONE_LABEL, value: NONE },
  { label: LAYER_KIND_LABELS.drywall, value: 'drywall' },
  { label: LAYER_KIND_LABELS.plaster, value: 'plaster' },
  { label: LAYER_KIND_LABELS['wood-plank'], value: 'wood-plank' },
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
  const i18n = usePascalI18n()
  return (
    <>
      <SelectControl
        label={sizeLabel}
        onChange={(size) => onChange({ size })}
        options={LUMBER_OPTIONS}
        value={framing.size}
      />
      <SizeSelect
        format={(value) => formatSpacing(value, unit, i18n)}
        label={i18n._({ id: 'node.shared.buildUpControls.spacing', message: 'Spacing' })}
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
  const i18n = usePascalI18n()
  return (
    <>
      <SelectControl
        label={label}
        onChange={(kind) =>
          onChange(kind === NONE ? undefined : { thickness: layer?.thickness ?? added, kind })
        }
        options={(optional ? OPTIONAL_PANEL_OPTIONS : PANEL_OPTIONS).map((option) => ({
          ...option,
          label: i18n._(option.label),
        }))}
        value={layer?.kind ?? NONE}
      />
      {layer && (
        <SizeSelect
          format={(value) => formatLayerThickness(value, unit)}
          label={i18n._({
            id: 'node.shared.buildUpControls.labelThickness',
            message: '{label} thickness',
            values: { label },
          })}
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
  const i18n = usePascalI18n()
  return (
    <>
      <SelectControl
        label={i18n._({ id: 'node.shared.buildUpControls.insulation', message: 'Insulation' })}
        onChange={(kind) =>
          onChange(
            kind === NONE
              ? undefined
              : { kind, thickness: kind === 'rigid' ? 2 * INCH : framingDepth },
          )
        }
        options={INSULATION_OPTIONS.map((option) => ({ ...option, label: i18n._(option.label) }))}
        value={layer?.kind ?? NONE}
      />
      {layer && (
        <ThicknessField
          label={i18n._({
            id: 'node.shared.buildUpControls.insulationThickness',
            message: 'Insulation thickness',
          })}
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
  const i18n = usePascalI18n()
  return (
    <>
      <SelectControl
        label={label}
        onChange={(kind) =>
          onChange(kind === NONE ? undefined : { kind, thickness: FINISH_THICKNESS[kind] })
        }
        options={FINISH_OPTIONS.map((option) => ({ ...option, label: i18n._(option.label) }))}
        value={layer?.kind ?? NONE}
      />
      {layer?.kind === 'drywall' && (
        <SizeSelect
          format={(value) => formatLayerThickness(value, unit)}
          label={i18n._({
            id: 'node.shared.buildUpControls.drywallThickness',
            message: 'Drywall thickness',
          })}
          onChange={(thickness) => onChange({ kind: 'drywall', thickness })}
          sizes={DRYWALL_THICKNESSES}
          value={layer.thickness}
        />
      )}
    </>
  )
}

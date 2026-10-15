'use client'

import type { CurtainGrid, RoofGlazing } from '@pascal-app/core'
import {
  getLinearUnitLabel,
  linearControlValueToMeters,
  metersToLinearUnit,
  PanelSection,
  SegmentedControl,
  SelectControl,
  SliderControl,
} from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { useCallback } from 'react'
import type { createRoofGlazingPreview } from './glazing-preview'

type Preview = ReturnType<typeof createRoofGlazingPreview>
type NumberField =
  | 'frameWidth'
  | 'frameDepth'
  | 'glassThickness'
  | 'glassOpacity'
  | 'glassRoughness'

export function GlazingNumber({
  field,
  label,
  value,
  preview,
  fraction = false,
  mixed = false,
}: {
  field: NumberField
  label: string
  value: number
  preview: Preview
  fraction?: boolean
  mixed?: boolean
}) {
  const unit = useViewer((state) => state.unit)
  const millimeters = !fraction && unit === 'metric'
  const display = (meters: number) =>
    millimeters ? meters * 1000 : metersToLinearUnit(meters, unit)
  const onChange = useCallback(
    (input: number) => {
      const next = fraction
        ? input / 100
        : millimeters
          ? Math.max(0.001, input / 1000)
          : linearControlValueToMeters(input, unit, { minMeters: 0.001 })
      preview.previewGlazing((config) => ({ ...config, [field]: next }))
    },
    [field, fraction, millimeters, preview, unit],
  )
  return (
    <SliderControl
      label={label}
      value={fraction ? value * 100 : display(value)}
      mixed={mixed}
      min={fraction ? (field === 'glassOpacity' ? 5 : 0) : display(0.001)}
      max={fraction ? 100 : undefined}
      unit={fraction ? '%' : millimeters ? 'mm' : getLinearUnitLabel(unit)}
      precision={fraction ? 0 : millimeters ? 1 : 3}
      step={fraction || millimeters ? 1 : 0.005}
      onChange={onChange}
      onCommit={preview.finish}
      onCancel={preview.cancel}
      restoreOnCommit={false}
      previewWhileTyping
    />
  )
}

export function GlazingGridControls({
  axis,
  title,
  description,
  grid,
  grids,
  preview,
}: {
  axis: 'across' | 'along'
  title: string
  description: string
  grid: CurtainGrid
  grids: readonly CurtainGrid[]
  preview: Preview
}) {
  const unit = useViewer((state) => state.unit)
  const patch = useCallback(
    (data: Partial<CurtainGrid>, commit = false) => {
      preview.previewGlazing((config) => ({ ...config, [axis]: { ...config[axis], ...data } }))
      if (commit) preview.commit()
    },
    [axis, preview],
  )
  const mixedLayout = grids.some((value) => value.layout !== grid.layout)
  return (
    <PanelSection title={title}>
      <SelectControl
        label="Layout"
        value={grid.layout}
        mixed={mixedLayout}
        options={[
          { value: 'maximum-spacing', label: 'Maximum spacing' },
          { value: 'count', label: 'Panel count' },
          { value: 'fixed-spacing', label: 'Fixed spacing' },
        ]}
        onChange={(layout) => patch({ layout }, true)}
      />
      {mixedLayout ? (
        <p className="pt-1 text-[11px] text-muted-foreground">Choose a layout to edit the grid.</p>
      ) : grid.layout === 'count' ? (
        <SliderControl
          label="Panels"
          value={grid.count}
          mixed={grids.some((value) => value.count !== grid.count)}
          min={1}
          max={32}
          step={1}
          precision={0}
          onChange={(count) => patch({ count: Math.round(count) })}
          onCommit={preview.finish}
          onCancel={preview.cancel}
          restoreOnCommit={false}
          previewWhileTyping
        />
      ) : (
        <SliderControl
          label={grid.layout === 'maximum-spacing' ? 'Max spacing' : 'Spacing'}
          value={metersToLinearUnit(grid.spacing, unit)}
          mixed={grids.some((value) => value.spacing !== grid.spacing)}
          min={metersToLinearUnit(0.2, unit)}
          max={metersToLinearUnit(100, unit)}
          unit={getLinearUnitLabel(unit)}
          step={0.05}
          precision={2}
          onChange={(input) =>
            patch({
              spacing: linearControlValueToMeters(input, unit, { minMeters: 0.2, maxMeters: 100 }),
            })
          }
          onCommit={preview.finish}
          onCancel={preview.cancel}
          restoreOnCommit={false}
          previewWhileTyping
        />
      )}
      {!mixedLayout && grid.layout === 'fixed-spacing' && (
        <div className="flex flex-col gap-2 pt-1" role="group" aria-label={`${title} alignment`}>
          <span className="text-xs text-muted-foreground">Alignment</span>
          <SegmentedControl
            value={grid.alignment}
            mixed={grids.some((value) => value.alignment !== grid.alignment)}
            options={[
              { value: 'start', label: 'Start' },
              { value: 'center', label: 'Center' },
              { value: 'end', label: 'End' },
            ]}
            onChange={(alignment) => patch({ alignment }, true)}
          />
        </div>
      )}
      <p className="pt-1 text-[11px] leading-relaxed text-muted-foreground">{description}</p>
    </PanelSection>
  )
}

export function GlazingColor({
  field,
  label,
  value,
  mixed,
  preview,
}: {
  field: 'glassColor' | 'frameColor'
  label: string
  value: string
  mixed: boolean
  preview: Preview
}) {
  return (
    <label className="flex h-10 items-center justify-between gap-2 rounded-lg border border-border/50 bg-[#2C2C2E] px-3 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span className="flex items-center gap-2">
        <span className="font-mono text-[11px] text-foreground">
          {mixed ? 'Mixed' : value.toUpperCase()}
        </span>
        <input
          aria-label={label}
          type="color"
          value={value}
          className="size-6 cursor-pointer overflow-hidden rounded border border-border/50 bg-transparent p-0 focus-visible:outline-2 focus-visible:outline-ring"
          onChange={(event) =>
            preview.previewGlazing((config) => ({ ...config, [field]: event.target.value }))
          }
          onBlur={preview.finish}
          onKeyDown={(event) => {
            if (event.key === 'Escape') preview.cancel()
          }}
        />
      </span>
    </label>
  )
}

export const GLAZING_INFILL_OPTIONS: { value: RoofGlazing['panelType']; label: string }[] = [
  { value: 'glass', label: 'Glass' },
  { value: 'solid', label: 'Solid' },
  { value: 'empty', label: 'Empty' },
]

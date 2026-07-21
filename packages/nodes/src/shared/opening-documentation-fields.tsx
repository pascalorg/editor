'use client'

import { getLinearUnitLabel, linearUnitToMeters, metersToLinearUnit } from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'

type OpeningDocumentationPatch = {
  mark?: string
  constructionType?: 'framed' | 'masonry'
  dimensionReference?: 'nominal' | 'rough-opening' | 'masonry-opening' | 'finish-opening'
  roughOpeningWidth?: number
  roughOpeningHeight?: number
  masonryOpeningWidth?: number
  masonryOpeningHeight?: number
  finishOpeningWidth?: number
  finishOpeningHeight?: number
}

export function OpeningDocumentationFields({
  mark,
  constructionType = 'framed',
  dimensionReference = 'nominal',
  roughOpeningWidth,
  roughOpeningHeight,
  masonryOpeningWidth,
  masonryOpeningHeight,
  finishOpeningWidth,
  finishOpeningHeight,
  onChange,
}: OpeningDocumentationPatch & {
  onChange: (patch: OpeningDocumentationPatch) => void
}) {
  return (
    <div className="flex flex-col gap-2 px-1 pb-1">
      <label className="flex flex-col gap-1">
        <span className="font-medium text-[10px] text-muted-foreground/80 uppercase tracking-wider">
          Mark
        </span>
        <input
          className="h-8 rounded-lg border border-border/50 bg-[#2C2C2E] px-2.5 font-mono text-foreground text-xs outline-none transition-colors placeholder:text-muted-foreground/50 focus:border-orange-400/60"
          defaultValue={mark ?? ''}
          key={`mark:${mark ?? ''}`}
          maxLength={16}
          onBlur={(event) => {
            const next = event.currentTarget.value.trim().toLocaleUpperCase()
            if (next !== (mark ?? '')) onChange({ mark: next || undefined })
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.currentTarget.blur()
            if (event.key === 'Escape') {
              event.currentTarget.value = mark ?? ''
              event.currentTarget.blur()
            }
          }}
          placeholder="Auto-assigned"
        />
      </label>
      <div className="grid grid-cols-2 gap-2">
        <label className="flex flex-col gap-1">
          <span className="font-medium text-[10px] text-muted-foreground/80 uppercase tracking-wider">
            Construction
          </span>
          <select
            className="h-8 rounded-lg border border-border/50 bg-[#2C2C2E] px-2 text-foreground text-xs outline-none focus:border-orange-400/60"
            onChange={(event) => {
              const next = event.currentTarget.value as 'framed' | 'masonry'
              onChange({
                constructionType: next,
                dimensionReference:
                  next === 'masonry' && dimensionReference === 'nominal'
                    ? 'masonry-opening'
                    : dimensionReference,
              })
            }}
            value={constructionType}
          >
            <option value="framed">Framed</option>
            <option value="masonry">Masonry</option>
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="font-medium text-[10px] text-muted-foreground/80 uppercase tracking-wider">
            Dimension to
          </span>
          <select
            className="h-8 rounded-lg border border-border/50 bg-[#2C2C2E] px-2 text-foreground text-xs outline-none focus:border-orange-400/60"
            onChange={(event) =>
              onChange({
                dimensionReference: event.currentTarget
                  .value as OpeningDocumentationPatch['dimensionReference'],
              })
            }
            value={dimensionReference}
          >
            <option value="nominal">Nominal</option>
            <option value="rough-opening">Rough opening</option>
            <option value="masonry-opening">Masonry opening</option>
            <option value="finish-opening">Finish opening</option>
          </select>
        </label>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <OptionalMeterInput
          label="RO Width"
          onChange={(value) => onChange({ roughOpeningWidth: value })}
          value={roughOpeningWidth}
        />
        <OptionalMeterInput
          label="RO Height"
          onChange={(value) => onChange({ roughOpeningHeight: value })}
          value={roughOpeningHeight}
        />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <OptionalMeterInput
          label="MO Width"
          onChange={(value) => onChange({ masonryOpeningWidth: value })}
          value={masonryOpeningWidth}
        />
        <OptionalMeterInput
          label="MO Height"
          onChange={(value) => onChange({ masonryOpeningHeight: value })}
          value={masonryOpeningHeight}
        />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <OptionalMeterInput
          label="FO Width"
          onChange={(value) => onChange({ finishOpeningWidth: value })}
          value={finishOpeningWidth}
        />
        <OptionalMeterInput
          label="FO Height"
          onChange={(value) => onChange({ finishOpeningHeight: value })}
          value={finishOpeningHeight}
        />
      </div>
      <p className="px-0.5 text-[10px] text-muted-foreground/65 leading-4">
        Leave RO, MO, and FO values blank until verified by the applicable manufacturer or trade.
      </p>
    </div>
  )
}

function OptionalMeterInput({
  label,
  value,
  onChange,
}: {
  label: string
  value?: number
  onChange: (value: number | undefined) => void
}) {
  const unit = useViewer((state) => state.unit)
  const displayValue = value === undefined ? '' : roundForInput(metersToLinearUnit(value, unit))

  return (
    <label className="flex flex-col gap-1">
      <span className="font-medium text-[10px] text-muted-foreground/80 uppercase tracking-wider">
        {label}
      </span>
      <div className="flex h-8 items-center rounded-lg border border-border/50 bg-[#2C2C2E] focus-within:border-orange-400/60">
        <input
          className="min-w-0 flex-1 bg-transparent px-2 font-mono text-foreground text-xs outline-none placeholder:text-muted-foreground/50"
          defaultValue={displayValue}
          key={`${label}:${displayValue}`}
          min={0.01}
          onBlur={(event) => {
            const raw = event.currentTarget.value
            if (raw === String(displayValue)) return
            const parsed = Number.parseFloat(raw)
            const next =
              raw === '' || !Number.isFinite(parsed) || parsed <= 0
                ? undefined
                : linearUnitToMeters(parsed, unit)
            if (next !== value) onChange(next)
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.currentTarget.blur()
            if (event.key === 'Escape') {
              event.currentTarget.value = String(displayValue)
              event.currentTarget.blur()
            }
          }}
          onWheel={(event) => event.currentTarget.blur()}
          placeholder="Verify"
          step={unit === 'imperial' ? 0.01 : 0.001}
          type="number"
        />
        <span className="pr-2 font-mono text-[10px] text-muted-foreground">
          {getLinearUnitLabel(unit)}
        </span>
      </div>
    </label>
  )
}

function roundForInput(value: number): number {
  return Math.round(value * 1000) / 1000
}

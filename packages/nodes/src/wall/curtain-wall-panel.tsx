'use client'

import {
  type CurtainGrid,
  type CurtainPanelType,
  type CurtainWallConfig,
  curtainGridPositions,
  curtainPanelType,
  getCurtainWallConfig,
  getWallCurveLength,
  type WallNode,
} from '@pascal-app/core'
import {
  getLinearUnitLabel,
  linearControlValueToMeters,
  metersToLinearUnit,
  PanelSection,
  SegmentedControl,
  SliderControl,
} from '@pascal-app/editor'
import { useState } from 'react'
import { CurtainFrameMaterial } from './curtain-frame-material'

type Props = {
  node: WallNode
  height: number
  unit: 'metric' | 'imperial'
  onUpdate: (patch: Partial<WallNode>) => void
  onPreview: (patch: Partial<WallNode>) => void
  onCommit: () => void
  onCancel: () => void
}

function Choice<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: T
  options: readonly { value: T; label: string }[]
  onChange: (value: T) => void
}) {
  return (
    <label className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
      {label}
      <select
        aria-label={label}
        className="max-w-[160px] rounded-md border border-border bg-background px-2 py-1.5 text-foreground"
        onChange={(event) => {
          const option = options.find((entry) => entry.value === event.target.value)
          if (option) onChange(option.value)
        }}
        value={value}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  )
}

function LengthControl({
  label,
  value,
  min,
  max,
  unit,
  onChange,
  onCommit,
  onCancel,
}: {
  label: string
  value: number
  min: number
  max: number
  unit: Props['unit']
  onChange: (value: number) => void
  onCommit: () => void
  onCancel: () => void
}) {
  return (
    <SliderControl
      onCommit={onCommit}
      onCancel={onCancel}
      restoreOnCommit={false}
      previewWhileTyping
      label={label}
      max={metersToLinearUnit(max, unit)}
      min={metersToLinearUnit(min, unit)}
      onChange={(next) =>
        onChange(linearControlValueToMeters(next, unit, { minMeters: min, maxMeters: max }))
      }
      precision={3}
      step={0.005}
      unit={getLinearUnitLabel(unit)}
      value={metersToLinearUnit(value, unit)}
    />
  )
}

function GridSection({
  onPreview,
  title,
  value,
  unit,
  onChange,
  onCommit,
  onCancel,
}: {
  title: string
  value: CurtainGrid
  unit: Props['unit']
  onChange: (grid: CurtainGrid) => void
  onPreview: (grid: CurtainGrid) => void
  onCommit: () => void
  onCancel: () => void
}) {
  return (
    <PanelSection title={title}>
      <Choice
        label="Layout"
        onChange={(layout) => onChange({ ...value, layout })}
        options={[
          { label: 'Panel count', value: 'count' },
          { label: 'Maximum spacing', value: 'maximum-spacing' },
          { label: 'Fixed spacing', value: 'fixed-spacing' },
        ]}
        value={value.layout}
      />
      {value.layout === 'count' ? (
        <SliderControl
          onCommit={onCommit}
          onCancel={onCancel}
          restoreOnCommit={false}
          previewWhileTyping
          label="Panels"
          max={32}
          min={1}
          onChange={(count) => onPreview({ ...value, count: Math.round(count) })}
          precision={0}
          step={1}
          value={value.count}
        />
      ) : (
        <LengthControl
          onCommit={onCommit}
          onCancel={onCancel}
          label="Spacing"
          max={100}
          min={0.2}
          onChange={(spacing) => onPreview({ ...value, spacing })}
          unit={unit}
          value={value.spacing}
        />
      )}
      {value.layout === 'fixed-spacing' && (
        <SegmentedControl
          onChange={(alignment) => onChange({ ...value, alignment })}
          options={[
            { label: 'Start', value: 'start' },
            { label: 'Center', value: 'center' },
            { label: 'End', value: 'end' },
          ]}
          value={value.alignment}
        />
      )}
    </PanelSection>
  )
}

const PANEL_OPTIONS = [
  { label: 'Glass', value: 'glass' },
  { label: 'Solid', value: 'solid' },
  { label: 'Empty', value: 'empty' },
] as const

export function CurtainWallPanel({
  node,
  height,
  unit,
  onUpdate,
  onPreview,
  onCommit,
  onCancel,
}: Props) {
  const config = getCurtainWallConfig(node)
  const update = (patch: Partial<CurtainWallConfig>, preview = false) => {
    const slots = { ...node.slots }
    if (patch.glassOpacity !== undefined || patch.glassRoughness !== undefined)
      delete slots['curtain-glass']
    ;(preview ? onPreview : onUpdate)({ curtainWall: { ...config, ...patch }, slots })
  }
  const [selectedColumn, setColumn] = useState(0)
  const [selectedRow, setRow] = useState(0)
  const columnCount = curtainGridPositions(getWallCurveLength(node), config.columns).length - 1
  const rowCount = curtainGridPositions(height, config.rows).length - 1
  const column = Math.max(0, Math.min(selectedColumn, columnCount - 1))
  const row = Math.max(0, Math.min(selectedRow, rowCount - 1))
  const selectedType = curtainPanelType(config, column, row, rowCount)
  const changePanel = (type?: CurtainPanelType) =>
    update({
      panels: [
        ...config.panels.filter((panel) => panel.column !== column || panel.row !== row),
        ...(type ? [{ column, row, type }] : []),
      ],
    })
  const colors = [
    { key: 'frameColor', label: 'Frame color', slot: 'curtain-frame' },
    { key: 'glassColor', label: 'Glass tint', slot: 'curtain-glass' },
    { key: 'solidColor', label: 'Solid color', slot: 'curtain-solid' },
  ] as const

  return (
    <>
      <PanelSection title="Curtain wall">
        <Choice
          label="Construction"
          onChange={(construction) => update({ construction })}
          options={[
            { label: 'Stick-built', value: 'stick' },
            { label: 'Unitized', value: 'unitized' },
          ]}
          value={config.construction}
        />
        <Choice
          label="Framing"
          onChange={(framing) => update({ framing })}
          options={[
            { label: 'Fully capped', value: 'capped' },
            { label: 'Vertical caps', value: 'vertical-caps' },
            { label: 'Horizontal caps', value: 'horizontal-caps' },
            { label: 'Structural glazing', value: 'structural-glazing' },
          ]}
          value={config.framing}
        />
        <p className="text-[11px] text-muted-foreground">
          {config.construction === 'unitized'
            ? 'Separate framed modules with joints between units.'
            : 'Continuous mullions and transoms assembled along the wall.'}
        </p>
        {config.framing !== 'capped' && (
          <p className="text-[11px] text-muted-foreground">
            Uncapped members sit behind the glazing.
          </p>
        )}
      </PanelSection>
      <GridSection
        onChange={(columns) => update({ columns })}
        onPreview={(columns) => update({ columns }, true)}
        onCommit={onCommit}
        onCancel={onCancel}
        title="Columns"
        unit={unit}
        value={config.columns}
      />
      <GridSection
        onChange={(rows) => update({ rows })}
        onPreview={(rows) => update({ rows }, true)}
        onCommit={onCommit}
        onCancel={onCancel}
        title="Rows"
        unit={unit}
        value={config.rows}
      />
      {((getWallCurveLength(node) / config.columns.spacing > 32 &&
        config.columns.layout !== 'count') ||
        (height / config.rows.spacing > 32 && config.rows.layout !== 'count')) && (
        <p className="px-3 text-[11px] text-muted-foreground">
          Grid limited to 32 panels per axis. Spacing expands to fit this wall.
        </p>
      )}
      <PanelSection title="Frame profiles">
        <LengthControl
          onCommit={onCommit}
          onCancel={onCancel}
          label="Mullion width"
          max={0.3}
          min={0.01}
          onChange={(mullionWidth) => update({ mullionWidth }, true)}
          unit={unit}
          value={config.mullionWidth}
        />
        <LengthControl
          onCommit={onCommit}
          onCancel={onCancel}
          label="Transom width"
          max={0.3}
          min={0.01}
          onChange={(transomWidth) => update({ transomWidth }, true)}
          unit={unit}
          value={config.transomWidth}
        />
        <LengthControl
          onCommit={onCommit}
          onCancel={onCancel}
          label="Border width"
          max={0.3}
          min={0.01}
          onChange={(perimeterWidth) => update({ perimeterWidth }, true)}
          unit={unit}
          value={config.perimeterWidth}
        />
        {(config.construction === 'unitized' || config.framing !== 'capped') && (
          <LengthControl
            onCommit={onCommit}
            onCancel={onCancel}
            label="Joint width"
            max={0.05}
            min={0.002}
            onChange={(jointWidth) => update({ jointWidth }, true)}
            unit={unit}
            value={config.jointWidth}
          />
        )}
      </PanelSection>
      <PanelSection title="Panels and glazing">
        <Choice
          label="Default panel"
          onChange={(panelType) => update({ panelType })}
          options={PANEL_OPTIONS}
          value={config.panelType}
        />
        <Choice
          label="Solid band"
          onChange={(spandrel) => update({ spandrel })}
          options={[
            { label: 'None', value: 'none' },
            { label: 'Bottom row', value: 'bottom' },
            { label: 'Top row', value: 'top' },
          ]}
          value={config.spandrel}
        />
        <LengthControl
          onCommit={onCommit}
          onCancel={onCancel}
          label="Panel thickness"
          max={0.08}
          min={0.004}
          onChange={(glassThickness) => update({ glassThickness }, true)}
          unit={unit}
          value={config.glassThickness}
        />
        <SliderControl
          onCommit={onCommit}
          onCancel={onCancel}
          restoreOnCommit={false}
          previewWhileTyping
          label="Glass opacity"
          max={1}
          min={0.05}
          onChange={(glassOpacity) => update({ glassOpacity }, true)}
          precision={2}
          step={0.05}
          value={config.glassOpacity}
        />
        <SliderControl
          onCommit={onCommit}
          onCancel={onCancel}
          restoreOnCommit={false}
          previewWhileTyping
          label="Glass roughness"
          max={1}
          min={0}
          onChange={(glassRoughness) => update({ glassRoughness }, true)}
          precision={2}
          step={0.05}
          value={config.glassRoughness}
        />
        <CurtainFrameMaterial node={node} onCommit={onCommit} />
        {colors
          .filter(({ key }) => key !== 'frameColor' || !node.slots?.['curtain-frame'])
          .map(({ key, label, slot }) => (
            <label
              className="flex items-center justify-between text-xs text-muted-foreground"
              key={key}
            >
              {label}
              <input
                aria-label={label}
                className="h-7 w-10 cursor-pointer rounded border border-border bg-transparent"
                onBlur={onCommit}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') {
                    event.preventDefault()
                    onCancel()
                  }
                }}
                onChange={(event) => {
                  const slots = { ...node.slots }
                  delete slots[slot]
                  onPreview({ curtainWall: { ...config, [key]: event.target.value }, slots })
                }}
                type="color"
                value={config[key]}
              />
            </label>
          ))}
      </PanelSection>
      <PanelSection title="Individual panel">
        <p className="text-[11px] text-muted-foreground">
          Columns run from the wall start. Rows count upward.
        </p>
        <SliderControl
          label="Column"
          max={Math.max(1, columnCount)}
          min={1}
          onChange={(value) => setColumn(Math.round(value) - 1)}
          precision={0}
          step={1}
          value={column + 1}
        />
        <SliderControl
          label="Row"
          max={Math.max(1, rowCount)}
          min={1}
          onChange={(value) => setRow(Math.round(value) - 1)}
          precision={0}
          step={1}
          value={row + 1}
        />
        <Choice
          label="Panel infill"
          onChange={changePanel}
          options={PANEL_OPTIONS}
          value={selectedType}
        />
        <button
          className="rounded border border-border px-2 py-1 text-xs"
          onClick={() => changePanel()}
          type="button"
        >
          Reset this panel
        </button>
        <p className="text-[11px] text-muted-foreground">
          Use the Door or Window tool to add an opening through the wall.
        </p>
      </PanelSection>
    </>
  )
}

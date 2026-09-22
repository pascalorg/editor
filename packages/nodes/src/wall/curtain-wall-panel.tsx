'use client'

import {
  type CurtainGrid,
  type CurtainPanelType,
  type CurtainWallConfig,
  curtainGridPositions,
  curtainPanelType,
  getCurtainWallConfig,
  getWallCurveLength,
  getWallThickness,
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
import { useCurtainPanelHighlight } from './curtain-panel-highlight'

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
  profile = false,
}: {
  profile?: boolean
  label: string
  value: number
  min: number
  max: number
  unit: Props['unit']
  onChange: (value: number) => void
  onCommit: () => void
  onCancel: () => void
}) {
  const millimeters = profile && unit === 'metric'
  const display = (meters: number) =>
    millimeters ? meters * 1000 : metersToLinearUnit(meters, unit)
  return (
    <SliderControl
      onCommit={onCommit}
      onCancel={onCancel}
      restoreOnCommit={false}
      previewWhileTyping
      label={label}
      max={display(max)}
      min={display(min)}
      onChange={(next) =>
        onChange(
          millimeters
            ? Math.max(min, Math.min(max, next / 1000))
            : linearControlValueToMeters(next, unit, { minMeters: min, maxMeters: max }),
        )
      }
      precision={millimeters ? 1 : 3}
      step={millimeters ? 1 : 0.005}
      unit={millimeters ? 'mm' : getLinearUnitLabel(unit)}
      value={display(value)}
    />
  )
}

function GridSection({
  length,
  vertical = false,
  onPreview,
  title,
  value,
  unit,
  onChange,
  onCommit,
  onCancel,
}: {
  length: number
  vertical?: boolean
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
            { label: vertical ? 'Bottom' : 'Start', value: 'start' },
            { label: 'Center', value: 'center' },
            { label: vertical ? 'Top' : 'End', value: 'end' },
          ]}
          value={value.alignment}
        />
      )}
      <p className="text-[11px] text-muted-foreground">
        {(() => {
          const positions = curtainGridPositions(length, value)
          const spans = positions.slice(1).map((position, i) => position - positions[i]!)
          if (!spans.length) return 'No panels'
          const min = metersToLinearUnit(Math.min(...spans), unit)
          const max = metersToLinearUnit(Math.max(...spans), unit)
          return `${spans.length} ${vertical ? 'rows' : 'columns'} · ${min.toFixed(2)}${max - min > 0.005 ? `–${max.toFixed(2)}` : ''} ${getLinearUnitLabel(unit)} grid spacing`
        })()}
      </p>
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
    ;(preview ? onPreview : onUpdate)({ curtainWall: { ...config, ...patch } })
  }

  const [tintEditing, setTintEditing] = useState(false)
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

  const hiddenOverrides = config.panels.filter(
    (panel) => panel.column >= columnCount || panel.row >= rowCount,
  )
  const diagramWidth = Math.max(240, columnCount * 32)
  const diagramHeight = Math.max(150, rowCount * 32)
  const overridden = config.panels.some((panel) => panel.column === column && panel.row === row)
  const xs = curtainGridPositions(getWallCurveLength(node), config.columns)
  const ys = curtainGridPositions(height, config.rows)
  useCurtainPanelHighlight(
    node,
    xs[column] ?? 0,
    xs[column + 1] ?? 0,
    ys[row] ?? 0,
    ys[row + 1] ?? 0,
  )
  const hasGlass = xs
    .slice(1)
    .some((_, c) =>
      ys.slice(1).some((_, r) => curtainPanelType(config, c, r, rowCount) === 'glass'),
    )
  const paintedGlass = Boolean(node.slots?.['curtain-glass'])
  const effectiveThickness = Math.min(config.glassThickness, getWallThickness(node) * 0.45)

  return (
    <>
      <PanelSection title="Wall system">
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
        title="Column layout"
        length={getWallCurveLength(node)}
        unit={unit}
        value={config.columns}
      />
      <GridSection
        onChange={(rows) => update({ rows })}
        onPreview={(rows) => update({ rows }, true)}
        onCommit={onCommit}
        onCancel={onCancel}
        title="Row layout"
        length={height}
        vertical
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
      <PanelSection title="Frame dimensions">
        <LengthControl
          profile
          onCommit={onCommit}
          onCancel={onCancel}
          label="Vertical frame width"
          max={0.3}
          min={0.01}
          onChange={(mullionWidth) => update({ mullionWidth }, true)}
          unit={unit}
          value={config.mullionWidth}
        />
        <LengthControl
          profile
          onCommit={onCommit}
          onCancel={onCancel}
          label="Horizontal frame width"
          max={0.3}
          min={0.01}
          onChange={(transomWidth) => update({ transomWidth }, true)}
          unit={unit}
          value={config.transomWidth}
        />
        <LengthControl
          profile
          onCommit={onCommit}
          onCancel={onCancel}
          label="Border / opening frame"
          max={0.3}
          min={0.01}
          onChange={(perimeterWidth) => update({ perimeterWidth }, true)}
          unit={unit}
          value={config.perimeterWidth}
        />
        {(config.construction === 'unitized' || config.framing !== 'capped') && (
          <LengthControl
            profile
            onCommit={onCommit}
            onCancel={onCancel}
            label={config.construction === 'unitized' ? 'Module joint width' : 'Glazing gap'}
            max={0.05}
            min={0.002}
            onChange={(jointWidth) => update({ jointWidth }, true)}
            unit={unit}
            value={config.jointWidth}
          />
        )}
      </PanelSection>
      <PanelSection title="Panel infill">
        <Choice
          label="Default panel"
          onChange={(panelType) => update({ panelType })}
          options={PANEL_OPTIONS}
          value={config.panelType}
        />
        <Choice
          label="Opaque band"
          onChange={(spandrel) => update({ spandrel })}
          options={[
            { label: 'None', value: 'none' },
            { label: 'Bottom row', value: 'bottom' },
            { label: 'Top row', value: 'top' },
          ]}
          value={config.spandrel}
        />
        <p className="text-[11px] text-muted-foreground">
          Opaque bands replace a full row with solid panels. Apply their finish with the paint tool.
        </p>
        <LengthControl
          profile
          onCommit={onCommit}
          onCancel={onCancel}
          label="Panel thickness"
          max={0.08}
          min={0.004}
          onChange={(glassThickness) => update({ glassThickness }, true)}
          unit={unit}
          value={config.glassThickness}
        />
        {effectiveThickness < config.glassThickness - 1e-6 && (
          <p className="text-[11px] text-muted-foreground">
            Effective thickness:{' '}
            {unit === 'metric'
              ? `${(effectiveThickness * 1000).toFixed(1)} mm`
              : `${metersToLinearUnit(effectiveThickness, unit).toFixed(3)} ${getLinearUnitLabel(unit)}`}
            , limited by frame depth.
          </p>
        )}
      </PanelSection>
      <PanelSection title="Edit individual panels">
        <p className="text-[11px] text-muted-foreground">
          Choose a cell or enter its column and row. Use arrow keys to move between cells. Columns
          run from the wall start; rows count upward.
        </p>
        <div className="max-h-64 overflow-auto rounded border border-border">
          <svg
            viewBox={`0 0 ${diagramWidth} ${diagramHeight}`}
            style={{ width: diagramWidth, height: diagramHeight }}
            className="block"
            role="group"
            aria-label="Curtain wall panel selection"
          >
            {xs.slice(1).flatMap((_, c) =>
              ys.slice(1).map((_, r) => {
                const type = curtainPanelType(config, c, r, rowCount)
                const selected = c === column && r === row
                return (
                  <rect
                    key={`${c}-${r}`}
                    role="button"
                    tabIndex={selected ? 0 : -1}
                    aria-label={`Column ${c + 1}, row ${r + 1}: ${type}`}
                    aria-pressed={selected}
                    data-cell={`${c}-${r}`}
                    x={(c / columnCount) * diagramWidth}
                    y={diagramHeight - ((r + 1) / rowCount) * diagramHeight}
                    width={diagramWidth / columnCount}
                    height={diagramHeight / rowCount}
                    fill={
                      type === 'glass' ? '#53788a' : type === 'solid' ? '#64748b' : 'transparent'
                    }
                    stroke={selected ? '#fb923c' : '#94a3b8'}
                    strokeWidth={selected ? 3 : 1}
                    className="cursor-pointer focus:stroke-orange-400 focus:stroke-[3]"
                    onClick={() => {
                      setColumn(c)
                      setRow(r)
                    }}
                    onKeyDown={(event) => {
                      const arrows: Record<string, [number, number]> = {
                        ArrowLeft: [-1, 0],
                        ArrowRight: [1, 0],
                        ArrowUp: [0, 1],
                        ArrowDown: [0, -1],
                      }
                      const delta = arrows[event.key]
                      if (delta) {
                        event.preventDefault()
                        const nextColumn = Math.max(0, Math.min(columnCount - 1, c + delta[0]))
                        const nextRow = Math.max(0, Math.min(rowCount - 1, r + delta[1]))
                        setColumn(nextColumn)
                        setRow(nextRow)
                        const target =
                          event.currentTarget.parentElement?.querySelector<SVGRectElement>(
                            `[data-cell="${nextColumn}-${nextRow}"]`,
                          )
                        target?.focus()
                        target?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
                      }
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault()
                        setColumn(c)
                        setRow(r)
                      }
                    }}
                  />
                )
              }),
            )}
          </svg>
        </div>
        {hiddenOverrides.length > 0 && (
          <div className="space-y-2 text-[11px] text-muted-foreground">
            <p>
              {hiddenOverrides.length} custom panels are outside this grid. They return if the grid
              expands.
            </p>
            <button
              type="button"
              className="rounded border border-border px-2 py-1 text-xs"
              onClick={() =>
                update({
                  panels: config.panels.filter(
                    (panel) => panel.column < columnCount && panel.row < rowCount,
                  ),
                })
              }
            >
              Clear hidden overrides
            </button>
          </div>
        )}
        <p className="text-[11px] text-muted-foreground">
          Column {column + 1}, row {row + 1} ·{' '}
          {overridden ? 'Custom infill' : 'Following wall defaults'}
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
          className="rounded border border-border px-2 py-1 text-xs disabled:cursor-default disabled:opacity-40"
          disabled={!overridden}
          onClick={() => changePanel()}
          type="button"
        >
          Reset this panel
        </button>
        <p className="text-[11px] text-muted-foreground">
          Use the Door or Window tool to add an opening through the wall.
        </p>
      </PanelSection>
      {hasGlass && (
        <PanelSection title="Glass appearance">
          {paintedGlass && (
            <div className="space-y-2 text-xs text-muted-foreground">
              <p>Glass appearance is controlled by the paint tool.</p>
              <button
                type="button"
                className="rounded border border-border px-2 py-1"
                onClick={() => {
                  onCommit()
                  const slots = { ...node.slots }
                  delete slots['curtain-glass']
                  onUpdate({ slots })
                }}
              >
                Use glass settings instead
              </button>
            </div>
          )}
          {!paintedGlass && (
            <div className="space-y-2">
              <SliderControl
                onCommit={onCommit}
                onCancel={onCancel}
                restoreOnCommit={false}
                previewWhileTyping
                label="Opacity"
                max={100}
                min={5}
                onChange={(value) => update({ glassOpacity: value / 100 }, true)}
                precision={0}
                step={5}
                unit="%"
                value={Math.round(config.glassOpacity * 100)}
              />
              <SliderControl
                onCommit={onCommit}
                onCancel={onCancel}
                restoreOnCommit={false}
                previewWhileTyping
                label="Surface roughness"
                max={1}
                min={0}
                onChange={(glassRoughness) => update({ glassRoughness }, true)}
                precision={2}
                step={0.05}
                value={config.glassRoughness}
              />
              <label className="flex items-center justify-between text-xs text-muted-foreground">
                Glass tint
                <input
                  aria-label="Glass tint"
                  className="h-7 w-10 cursor-pointer rounded border border-border bg-transparent"
                  onKeyDown={(event) => {
                    if (event.key === 'Escape') {
                      event.preventDefault()
                      onCancel()
                      setTintEditing(false)
                    }
                  }}
                  onChange={(event) => {
                    setTintEditing(true)
                    update({ glassColor: event.target.value }, true)
                  }}
                  onInput={(event) => {
                    setTintEditing(true)
                    update({ glassColor: event.currentTarget.value }, true)
                  }}
                  type="color"
                  value={config.glassColor}
                />
              </label>
              {tintEditing && (
                <div className="flex gap-2">
                  <button
                    type="button"
                    className="rounded border border-border px-2 py-1 text-xs"
                    onClick={() => {
                      onCommit()
                      setTintEditing(false)
                    }}
                  >
                    Apply tint
                  </button>
                  <button
                    type="button"
                    className="rounded border border-border px-2 py-1 text-xs"
                    onClick={() => {
                      onCancel()
                      setTintEditing(false)
                    }}
                  >
                    Cancel tint
                  </button>
                </div>
              )}
              <p className="text-[11px] text-muted-foreground">
                Low roughness is smooth; high roughness gives a matte surface in rendered shading.
              </p>
            </div>
          )}
        </PanelSection>
      )}
    </>
  )
}

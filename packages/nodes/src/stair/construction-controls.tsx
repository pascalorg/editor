'use client'

import {
  type AnyNodeId,
  StairConstruction,
  type StairNode,
  type StairSegmentNode,
  useScene,
} from '@pascal-app/core'
import { MetricControl, SelectControl, ToggleControl } from '@pascal-app/editor'

const OPTIONS = [
  { label: 'Original', value: 'original' },
  { label: 'Solid', value: 'solid' },
  { label: 'Waist', value: 'waist' },
  { label: 'Open', value: 'open' },
  { label: 'Side stringers', value: 'side-stringers' },
  { label: 'Center stringer', value: 'center-stringer' },
]

export function StairConstructionControls({
  node,
  inherited,
  onChange,
}: {
  node: StairNode | StairSegmentNode
  inherited?: StairConstruction
  onChange: (construction: StairConstruction | undefined) => void
}) {
  const effective = node.construction ?? inherited
  const update = (patch: Partial<StairConstruction>) =>
    onChange(StairConstruction.parse({ ...effective, ...patch }))
  return (
    <div className="space-y-3">
      <SelectControl
        label="Body"
        value={node.construction?.mode ?? 'original'}
        options={OPTIONS.map((option) =>
          option.value === 'original' && inherited ? { ...option, label: 'Inherit' } : option,
        )}
        onChange={(mode) =>
          mode === 'original'
            ? onChange(undefined)
            : update({ mode: mode as StairConstruction['mode'] })
        }
      />
      {effective ? (
        <>
          {effective.mode === 'waist' ? (
            <MetricControl
              label="Waist thickness"
              min={0.001}
              value={effective.waistThickness}
              onChange={(waistThickness) => update({ waistThickness })}
              unit="m"
              step={0.01}
              precision={3}
            />
          ) : null}
          <MetricControl
            label="Tread thickness"
            min={0.001}
            value={effective.treadThickness}
            onChange={(treadThickness) => update({ treadThickness })}
            unit="m"
            step={0.01}
            precision={3}
          />
          <MetricControl
            label="Nosing"
            min={0}
            value={effective.nosing}
            onChange={(nosing) => update({ nosing })}
            unit="m"
            step={0.005}
            precision={3}
          />
          <MetricControl
            label="Tread finish"
            min={0}
            value={effective.finishThickness}
            onChange={(finishThickness) => update({ finishThickness })}
            unit="m"
            step={0.005}
            precision={3}
          />
          {effective.mode === 'solid' || effective.mode === 'waist' ? null : (
            <>
              <ToggleControl
                label="Closed risers"
                checked={effective.closedRisers}
                onChange={(closedRisers) => update({ closedRisers })}
              />
              {effective.closedRisers ? (
                <MetricControl
                  label="Riser thickness"
                  min={0.001}
                  value={effective.riserThickness}
                  onChange={(riserThickness) => update({ riserThickness })}
                  unit="m"
                  step={0.005}
                  precision={3}
                />
              ) : null}
            </>
          )}
          {effective.mode === 'side-stringers' || effective.mode === 'center-stringer' ? (
            <>
              <MetricControl
                label="Stringer width"
                min={0.001}
                value={effective.stringerWidth}
                onChange={(stringerWidth) => update({ stringerWidth })}
                unit="m"
                step={0.01}
                precision={3}
              />
              <MetricControl
                label="Stringer depth"
                min={0.001}
                value={effective.stringerDepth}
                onChange={(stringerDepth) => update({ stringerDepth })}
                unit="m"
                step={0.01}
                precision={3}
              />
            </>
          ) : null}
        </>
      ) : null}
    </div>
  )
}

export function StairConstructionField({
  node,
  onUpdate,
}: {
  node: StairNode
  onUpdate: (patch: Partial<StairNode>) => void
}) {
  return (
    <StairConstructionControls
      node={node}
      onChange={(construction) => onUpdate({ construction })}
    />
  )
}

export function StairSegmentConstructionField({
  node,
  onUpdate,
}: {
  node: StairSegmentNode
  onUpdate: (patch: Partial<StairSegmentNode>) => void
}) {
  const inherited = useScene((state) => {
    const parent = node.parentId ? state.nodes[node.parentId as AnyNodeId] : undefined
    return parent?.type === 'stair' ? parent.construction : undefined
  })
  return (
    <StairConstructionControls
      node={node}
      inherited={inherited}
      onChange={(construction) => onUpdate({ construction })}
    />
  )
}

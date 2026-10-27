'use client'

import {
  type AnyNodeId,
  StairConstruction,
  type StairNode,
  type StairSegmentNode,
  usePascalI18n,
  useScene,
} from '@pascal-app/core'
import { MetricControl, SelectControl, ToggleControl } from '@pascal-app/editor'

const OPTIONS = [
  {
    label: /* i18n */ { id: 'node.stair.constructionControls.original', message: 'Original' },
    value: 'original',
  },
  {
    label: /* i18n */ { id: 'node.stair.constructionControls.solid', message: 'Solid' },
    value: 'solid',
  },
  {
    label: /* i18n */ { id: 'node.stair.constructionControls.waist', message: 'Waist' },
    value: 'waist',
  },
  {
    label: /* i18n */ { id: 'node.stair.constructionControls.open', message: 'Open' },
    value: 'open',
  },
  {
    label: /* i18n */ {
      id: 'node.stair.constructionControls.sideStringers',
      message: 'Side stringers',
    },
    value: 'side-stringers',
  },
  {
    label: /* i18n */ {
      id: 'node.stair.constructionControls.centerStringer',
      message: 'Center stringer',
    },
    value: 'center-stringer',
  },
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
  const i18n = usePascalI18n()
  const effective = node.construction ?? inherited
  const update = (patch: Partial<StairConstruction>) =>
    onChange(StairConstruction.parse({ ...effective, ...patch }))
  return (
    <div className="space-y-3">
      <SelectControl
        label={i18n._({ id: 'node.stair.constructionControls.body', message: 'Body' })}
        value={node.construction?.mode ?? 'original'}
        options={OPTIONS.map((option) =>
          option.value === 'original' && inherited
            ? {
                ...option,
                label: i18n._({
                  id: 'node.stair.constructionControls.inherit',
                  message: 'Inherit',
                }),
              }
            : { ...option, label: i18n._(option.label) },
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
              label={i18n._({
                id: 'node.stair.constructionControls.waistThickness',
                message: 'Waist thickness',
              })}
              min={0.001}
              value={effective.waistThickness}
              onChange={(waistThickness) => update({ waistThickness })}
              unit="m"
              step={0.01}
              precision={3}
            />
          ) : null}
          <MetricControl
            label={i18n._({
              id: 'node.stair.constructionControls.treadThickness',
              message: 'Tread thickness',
            })}
            min={0.001}
            value={effective.treadThickness}
            onChange={(treadThickness) => update({ treadThickness })}
            unit="m"
            step={0.01}
            precision={3}
          />
          <MetricControl
            label={i18n._({ id: 'node.stair.constructionControls.nosing', message: 'Nosing' })}
            min={0}
            value={effective.nosing}
            onChange={(nosing) => update({ nosing })}
            unit="m"
            step={0.005}
            precision={3}
          />
          <MetricControl
            label={i18n._({
              id: 'node.stair.constructionControls.treadFinish',
              message: 'Tread finish',
            })}
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
                label={i18n._({
                  id: 'node.stair.constructionControls.closedRisers',
                  message: 'Closed risers',
                })}
                checked={effective.closedRisers}
                onChange={(closedRisers) => update({ closedRisers })}
              />
              {effective.closedRisers ? (
                <MetricControl
                  label={i18n._({
                    id: 'node.stair.constructionControls.riserThickness',
                    message: 'Riser thickness',
                  })}
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
                label={i18n._({
                  id: 'node.stair.constructionControls.stringerWidth',
                  message: 'Stringer width',
                })}
                min={0.001}
                value={effective.stringerWidth}
                onChange={(stringerWidth) => update({ stringerWidth })}
                unit="m"
                step={0.01}
                precision={3}
              />
              <MetricControl
                label={i18n._({
                  id: 'node.stair.constructionControls.stringerDepth',
                  message: 'Stringer depth',
                })}
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

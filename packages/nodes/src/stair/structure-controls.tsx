'use client'

import {
  type AnyNodeId,
  resolveStairStringerLayout,
  resolveStairStructure,
  STAIR_STRINGER_SPACINGS_IN,
  type StairNode,
  type StairSegmentNode,
  StairStructure,
  type StairStructureType,
  type StairTreadStock,
  useScene,
} from '@pascal-app/core'
import { formatLinearMeasurement, MetricControl, SelectControl } from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { useShallow } from 'zustand/react/shallow'

const IN = 0.0254
/** The concrete a poured flight is painted when it carries no paint of its own. */
const CONCRETE_PRESET = 'library:concrete-raw'

const STRUCTURE_OPTIONS: { label: string; value: StairStructureType | 'none' }[] = [
  { label: 'Original body', value: 'none' },
  { label: 'Wood stringers', value: 'wood-stringers' },
  { label: 'Concrete', value: 'concrete' },
  { label: 'Steel stringers', value: 'steel-stringers' },
]

const TREAD_LABELS: Record<StairTreadStock, string> = {
  '2x6-pair': 'Two 2x6',
  '5/4x6-pair': 'Two 5/4x6',
  '2x12': 'One 2x12',
  'plywood-finish': 'Plywood + finish',
}

type Choice = 'auto' | 'yes' | 'no'
const choiceOf = (value: boolean | undefined): Choice =>
  value === undefined ? 'auto' : value ? 'yes' : 'no'
const choiceValue = (choice: Choice): boolean | undefined =>
  choice === 'auto' ? undefined : choice === 'yes'

/**
 * How the stair is built (its stringers, with the code's numbers behind them):
 * wood stringers — stock, cut or housed, a maximum spacing that sets the count (or a count by
 * hand), treads, risers and treated lumber — a poured concrete flight, or steel channels. The
 * count it lands on shows under the controls.
 */
export function StairStructureControls({
  node,
  segments,
  onUpdate,
}: {
  node: StairNode
  segments: readonly StairSegmentNode[]
  onUpdate: (patch: Partial<StairNode>) => void
}) {
  const unit = useViewer((state) => state.unit)
  const metricNotation = useViewer((state) => state.metricNotation)
  const resolved = resolveStairStructure(node)
  const stored = node.structure ? StairStructure.safeParse(node.structure) : null
  const structure = stored?.success ? stored.data : null
  const update = (patch: Partial<StairStructure>) =>
    onUpdate({ structure: StairStructure.parse({ ...structure, ...patch }) })

  const setType = (value: StairStructureType | 'none') => {
    if (value === 'none') {
      onUpdate({
        structure: undefined,
        ...(node.materialPreset === CONCRETE_PRESET ? { materialPreset: undefined } : {}),
      })
      return
    }
    const painted = node.material !== undefined || typeof node.materialPreset === 'string'
    onUpdate({
      structure: StairStructure.parse({ ...structure, type: value }),
      // a poured flight reads as concrete until it is painted otherwise; leaving concrete takes
      // that paint back off
      ...(value === 'concrete' && !painted ? { materialPreset: CONCRETE_PRESET } : {}),
      ...(value !== 'concrete' && node.materialPreset === CONCRETE_PRESET
        ? { materialPreset: undefined }
        : {}),
    })
  }

  const flights = segments.filter((segment) => segment.segmentType === 'stair')
  const widths = flights.length ? flights.map((flight) => flight.width) : [node.width]
  const layouts =
    resolved && resolved.type !== 'concrete'
      ? widths.map((width) => ({ width, layout: resolveStairStringerLayout(width, resolved) }))
      : []
  const first = layouts[0]?.layout
  const autoCount =
    resolved && first
      ? resolveStairStringerLayout(widths[0]!, { ...resolved, stringerCount: undefined }).count
      : 0
  const wood = resolved?.type === 'wood-stringers'
  const spacingIn = structure ? Math.round((structure.stringerSpacing / IN) * 100) / 100 : 16
  const spacings: number[] = STAIR_STRINGER_SPACINGS_IN.includes(
    spacingIn as (typeof STAIR_STRINGER_SPACINGS_IN)[number],
  )
    ? [...STAIR_STRINGER_SPACINGS_IN]
    : [...STAIR_STRINGER_SPACINGS_IN, spacingIn].sort((a, b) => a - b)

  return (
    <div className="space-y-3">
      <SelectControl
        label="Structure"
        value={resolved?.type ?? 'none'}
        options={STRUCTURE_OPTIONS}
        onChange={setType}
      />
      {resolved && structure ? (
        <>
          {wood ? (
            <>
              <SelectControl
                label="Stringers"
                value={structure.stringerStock}
                options={[
                  { label: '2x12', value: '2x12' },
                  { label: '2x10', value: '2x10' },
                ]}
                onChange={(stringerStock) => update({ stringerStock })}
              />
              <SelectControl
                label="Stringer type"
                value={structure.stringerType}
                options={[
                  { label: 'Cut', value: 'cut' },
                  { label: 'Housed sides', value: 'housed' },
                ]}
                onChange={(stringerType) => update({ stringerType })}
              />
              <SelectControl
                label="Max spacing"
                value={String(spacingIn)}
                options={spacings.map((inches) => ({
                  label: `${inches} in o.c.`,
                  value: String(inches),
                }))}
                onChange={(value) => update({ stringerSpacing: Number(value) * IN })}
              />
            </>
          ) : null}
          {resolved.type !== 'concrete' && first ? (
            <>
              <SelectControl
                label="Stringer count"
                value={
                  structure.stringerCount === undefined ? 'auto' : String(structure.stringerCount)
                }
                options={[
                  { label: `Auto (${autoCount})`, value: 'auto' },
                  ...[2, 3, 4, 5, 6, 7, 8].map((count) => ({
                    label: String(count),
                    value: String(count),
                  })),
                ]}
                onChange={(value) =>
                  update({ stringerCount: value === 'auto' ? undefined : Number(value) })
                }
              />
              <SelectControl
                label="Treads"
                value={structure.treadStock ?? 'auto'}
                options={[
                  { label: `Auto (${TREAD_LABELS[resolved.treadStock]})`, value: 'auto' },
                  ...(Object.keys(TREAD_LABELS) as StairTreadStock[]).map((stock) => ({
                    label: TREAD_LABELS[stock],
                    value: stock,
                  })),
                ]}
                onChange={(value) =>
                  update({ treadStock: value === 'auto' ? undefined : (value as StairTreadStock) })
                }
              />
              <SelectControl
                label="Risers"
                value={choiceOf(structure.closedRisers)}
                options={[
                  { label: `Auto (${resolved.closedRisers ? 'closed' : 'open'})`, value: 'auto' },
                  { label: 'Closed (1x8 boards)', value: 'yes' },
                  { label: 'Open', value: 'no' },
                ]}
                onChange={(value) => update({ closedRisers: choiceValue(value as Choice) })}
              />
              {wood ? (
                <SelectControl
                  label="Lumber"
                  value={choiceOf(structure.treated)}
                  options={[
                    {
                      label: `Auto (${resolved.treated ? 'pressure-treated' : 'untreated'})`,
                      value: 'auto',
                    },
                    { label: 'Pressure-treated', value: 'yes' },
                    { label: 'Untreated', value: 'no' },
                  ]}
                  onChange={(value) => update({ treated: choiceValue(value as Choice) })}
                />
              ) : null}
            </>
          ) : null}
          <MetricControl
            label="Nosing"
            min={0}
            max={0.1}
            value={resolved.nosing}
            onChange={(nosing) => update({ nosing })}
            unit="m"
            step={0.005}
            precision={3}
          />
          <div role="status" className="space-y-1 px-1 text-[11px] text-muted-foreground">
            {resolved.type === 'concrete' ? (
              <div>A solid poured flight on a footing; risers closed, no stringers.</div>
            ) : (
              layouts.map(({ width, layout }, index) => (
                <div key={`${index}-${width}`}>
                  {layouts.length > 1 ? `Flight ${index + 1}: ` : ''}
                  {layout.count} {layout.steel ? 'steel channels' : 'stringers'}
                  {layout.count > 1
                    ? ` at ${formatLinearMeasurement(layout.spacing, unit, metricNotation)} o.c.`
                    : ''}
                  {layout.auto ? ' (auto)' : ''}
                </div>
              ))
            )}
          </div>
        </>
      ) : null}
    </div>
  )
}

/** The structure controls in the parametric inspector, over the stair's own flights. */
export function StairStructureField({
  node,
  onUpdate,
}: {
  node: StairNode
  onUpdate: (patch: Partial<StairNode>) => void
}) {
  const segments = useScene(
    useShallow((state) =>
      (node.children ?? [])
        .map((id) => state.nodes[id as AnyNodeId])
        .filter((child): child is StairSegmentNode => child?.type === 'stair-segment'),
    ),
  )
  return <StairStructureControls node={node} segments={segments} onUpdate={onUpdate} />
}

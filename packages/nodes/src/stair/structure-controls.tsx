'use client'

import {
  type AnyNodeId,
  type MessageDescriptor,
  type PascalI18n,
  resolveStairStringerLayout,
  resolveStairStructure,
  STAIR_STRINGER_SPACINGS_IN,
  type StairNode,
  type StairSegmentNode,
  StairStructure,
  type StairStructureType,
  type StairTreadStock,
  usePascalI18n,
  useScene,
} from '@pascal-app/core'
import { formatLinearMeasurement, MetricControl, SelectControl } from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { useShallow } from 'zustand/react/shallow'

const IN = 0.0254
/** The concrete a poured flight is painted when it carries no paint of its own. */
const CONCRETE_PRESET = 'library:concrete-raw'

const STRUCTURE_OPTIONS: { label: MessageDescriptor; value: StairStructureType | 'none' }[] = [
  {
    label: /* i18n */ { id: 'node.stair.structureControls.originalBody', message: 'Original body' },
    value: 'none',
  },
  {
    label: /* i18n */ {
      id: 'node.stair.structureControls.woodStringers',
      message: 'Wood stringers',
    },
    value: 'wood-stringers',
  },
  {
    label: /* i18n */ { id: 'node.stair.structureControls.concrete', message: 'Concrete' },
    value: 'concrete',
  },
  {
    label: /* i18n */ {
      id: 'node.stair.structureControls.steelStringers',
      message: 'Steel stringers',
    },
    value: 'steel-stringers',
  },
]

/** The lumber a tread is cut from; the trade size is a value, not copy. */
const TREAD_LABELS: Record<StairTreadStock, MessageDescriptor> = {
  '2x6-pair': /* i18n */ {
    id: 'node.stair.structureControls.twoStock',
    message: 'Two {stock}',
    values: { stock: '2x6' },
  },
  '5/4x6-pair': /* i18n */ {
    id: 'node.stair.structureControls.twoStock',
    message: 'Two {stock}',
    values: { stock: '5/4x6' },
  },
  '2x12': /* i18n */ {
    id: 'node.stair.structureControls.oneStock',
    message: 'One {stock}',
    values: { stock: '2x12' },
  },
  'plywood-finish': /* i18n */ {
    id: 'node.stair.structureControls.plywoodFinish',
    message: 'Plywood + finish',
  },
}

type Choice = 'auto' | 'yes' | 'no'
const choiceOf = (value: boolean | undefined): Choice =>
  value === undefined ? 'auto' : value ? 'yes' : 'no'
const choiceValue = (choice: Choice): boolean | undefined =>
  choice === 'auto' ? undefined : choice === 'yes'

/** A flight's stringers as the status line reads them: `3 stringers at 1' 4" o.c. (auto)`. */
function stringerLayoutLine(
  layout: { count: number; steel: boolean; auto: boolean },
  spacing: string,
  i18n: PascalI18n,
): string {
  const values = { count: layout.count, spacing }
  let line: string
  if (layout.steel)
    line =
      layout.count > 1
        ? i18n._({
            id: 'node.stair.structureControls.countSteelChannelsAtSpacing',
            message:
              '{count, plural, one {# steel channel at {spacing} o.c.} other {# steel channels at {spacing} o.c.}}',
            values,
          })
        : i18n._({
            id: 'node.stair.structureControls.countSteelChannels',
            message: '{count, plural, one {# steel channel} other {# steel channels}}',
            values,
          })
  else
    line =
      layout.count > 1
        ? i18n._({
            id: 'node.stair.structureControls.countStringersAtSpacing',
            message:
              '{count, plural, one {# stringer at {spacing} o.c.} other {# stringers at {spacing} o.c.}}',
            values,
          })
        : i18n._({
            id: 'node.stair.structureControls.countStringers',
            message: '{count, plural, one {# stringer} other {# stringers}}',
            values,
          })
  if (!layout.auto) return line
  return i18n._({
    id: 'node.stair.structureControls.layoutAuto',
    message: '{layout} (auto)',
    comment: 'The stringer count was chosen automatically, not set by hand.',
    values: { layout: line },
  })
}

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
  const i18n = usePascalI18n()
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
        label={i18n._({ id: 'node.stair.structureControls.structure', message: 'Structure' })}
        value={resolved?.type ?? 'none'}
        options={STRUCTURE_OPTIONS.map((option) => ({ ...option, label: i18n._(option.label) }))}
        onChange={setType}
      />
      {resolved && structure ? (
        <>
          {wood ? (
            <>
              <SelectControl
                label={i18n._({
                  id: 'node.stair.structureControls.stringers',
                  message: 'Stringers',
                })}
                value={structure.stringerStock}
                options={[
                  { label: '2x12', value: '2x12' },
                  { label: '2x10', value: '2x10' },
                ]}
                onChange={(stringerStock) => update({ stringerStock })}
              />
              <SelectControl
                label={i18n._({
                  id: 'node.stair.structureControls.stringerType',
                  message: 'Stringer type',
                })}
                value={structure.stringerType}
                options={[
                  {
                    label: i18n._({ id: 'node.stair.structureControls.cut', message: 'Cut' }),
                    value: 'cut',
                  },
                  {
                    label: i18n._({
                      id: 'node.stair.structureControls.housedSides',
                      message: 'Housed sides',
                    }),
                    value: 'housed',
                  },
                ]}
                onChange={(stringerType) => update({ stringerType })}
              />
              <SelectControl
                label={i18n._({
                  id: 'node.stair.structureControls.maxSpacing',
                  message: 'Max spacing',
                })}
                value={String(spacingIn)}
                options={spacings.map((inches) => ({
                  label: i18n._({
                    id: 'node.stair.structureControls.inchesInOC',
                    message: '{inches} in o.c.',
                    values: { inches },
                  }),
                  value: String(inches),
                }))}
                onChange={(value) => update({ stringerSpacing: Number(value) * IN })}
              />
            </>
          ) : null}
          {resolved.type !== 'concrete' && first ? (
            <>
              <SelectControl
                label={i18n._({
                  id: 'node.stair.structureControls.stringerCount',
                  message: 'Stringer count',
                })}
                value={
                  structure.stringerCount === undefined ? 'auto' : String(structure.stringerCount)
                }
                options={[
                  {
                    label: i18n._({
                      id: 'node.stair.structureControls.autoAutocount',
                      message: 'Auto ({autoCount})',
                      values: { autoCount },
                    }),
                    value: 'auto',
                  },
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
                label={i18n._({ id: 'node.stair.structureControls.treads', message: 'Treads' })}
                value={structure.treadStock ?? 'auto'}
                options={[
                  {
                    label: i18n._({
                      id: 'node.stair.structureControls.autoTreads',
                      message: 'Auto ({treads})',
                      values: { treads: i18n._(TREAD_LABELS[resolved.treadStock]) },
                    }),
                    value: 'auto',
                  },
                  ...(Object.keys(TREAD_LABELS) as StairTreadStock[]).map((stock) => ({
                    label: i18n._(TREAD_LABELS[stock]),
                    value: stock,
                  })),
                ]}
                onChange={(value) =>
                  update({ treadStock: value === 'auto' ? undefined : (value as StairTreadStock) })
                }
              />
              <SelectControl
                label={i18n._({ id: 'node.stair.structureControls.risers', message: 'Risers' })}
                value={choiceOf(structure.closedRisers)}
                options={[
                  {
                    label: resolved.closedRisers
                      ? i18n._({
                          id: 'node.stair.structureControls.autoClosed',
                          message: 'Auto (closed)',
                        })
                      : i18n._({
                          id: 'node.stair.structureControls.autoOpen',
                          message: 'Auto (open)',
                        }),
                    value: 'auto',
                  },
                  {
                    label: i18n._({
                      id: 'node.stair.structureControls.closed1x8Boards',
                      message: 'Closed (1x8 boards)',
                    }),
                    value: 'yes',
                  },
                  {
                    label: i18n._({ id: 'node.stair.structureControls.open', message: 'Open' }),
                    value: 'no',
                  },
                ]}
                onChange={(value) => update({ closedRisers: choiceValue(value as Choice) })}
              />
              {wood ? (
                <SelectControl
                  label={i18n._({ id: 'node.stair.structureControls.lumber', message: 'Lumber' })}
                  value={choiceOf(structure.treated)}
                  options={[
                    {
                      label: resolved.treated
                        ? i18n._({
                            id: 'node.stair.structureControls.autoPressureTreated',
                            message: 'Auto (pressure-treated)',
                          })
                        : i18n._({
                            id: 'node.stair.structureControls.autoUntreated',
                            message: 'Auto (untreated)',
                          }),
                      value: 'auto',
                    },
                    {
                      label: i18n._({
                        id: 'node.stair.structureControls.pressureTreated',
                        message: 'Pressure-treated',
                      }),
                      value: 'yes',
                    },
                    {
                      label: i18n._({
                        id: 'node.stair.structureControls.untreated',
                        message: 'Untreated',
                      }),
                      value: 'no',
                    },
                  ]}
                  onChange={(value) => update({ treated: choiceValue(value as Choice) })}
                />
              ) : null}
            </>
          ) : null}
          <MetricControl
            label={i18n._({ id: 'node.stair.structureControls.nosing', message: 'Nosing' })}
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
              <div>
                {i18n._({
                  id: 'node.stair.structureControls.aSolidPouredFlightOnA',
                  message: 'A solid poured flight on a footing; risers closed, no stringers.',
                })}
              </div>
            ) : (
              layouts.map(({ width, layout }, index) => {
                const line = stringerLayoutLine(
                  layout,
                  formatLinearMeasurement(layout.spacing, unit, metricNotation),
                  i18n,
                )
                return (
                  <div key={`${index}-${width}`}>
                    {layouts.length > 1
                      ? i18n._({
                          id: 'node.stair.structureControls.flightLayout',
                          message: 'Flight {number}: {layout}',
                          values: { number: index + 1, layout: line },
                        })
                      : line}
                  </div>
                )
              })
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

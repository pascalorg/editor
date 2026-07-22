'use client'

import {
  type AnyNodeId,
  type ConstructionDimensionDatumPolicy,
  type ConstructionDimensionDrawingPresentation,
  type ConstructionDimensionImperialPrecision,
  type ConstructionDimensionMetricNotation,
  type ConstructionDimensionNode,
  type ConstructionDimensionTerminator,
  type ConstructionDimensionTextPosition,
  type ConstructionDrawingType,
  resolveConstructionDimensionDrawingOverride,
  resolveConstructionDimensionDrawingPresentation,
  setConstructionDimensionDrawingPresentation,
  setConstructionDimensionDrawingSuppressedSegments,
  useScene,
} from '@pascal-app/core'
import {
  ActionButton,
  ActionGroup,
  DRAWING_TYPE_OPTIONS,
  PanelSection,
  PanelWrapper,
  SliderControl,
  triggerSFX,
  useDrawingView,
} from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { Trash2 } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'

const MODE_LABELS: Record<ConstructionDimensionNode['mode'], string> = {
  linear: 'Linear',
  radius: 'Radius',
  diameter: 'Diameter',
  'center-mark': 'Center mark',
  chord: 'Chord',
  'arc-length': 'Arc length',
  angular: 'Angular',
  coordinate: 'Coordinate',
}

const DATUM_POLICY_OPTIONS: Array<{ label: string; value: ConstructionDimensionDatumPolicy }> = [
  { label: 'Centerline', value: 'centerline' },
  { label: 'Wall face', value: 'wall-face' },
  { label: 'Structural face', value: 'structural-face' },
  { label: 'Finish face', value: 'finish-face' },
]

const TERMINATOR_OPTIONS: Array<{ label: string; value: ConstructionDimensionTerminator }> = [
  { label: 'Architectural tick', value: 'architectural-tick' },
  { label: 'Filled arrow', value: 'filled-arrow' },
  { label: 'Open arrow', value: 'open-arrow' },
  { label: 'Dot', value: 'dot' },
]

const TEXT_POSITION_OPTIONS: Array<{ label: string; value: ConstructionDimensionTextPosition }> = [
  { label: 'Above line', value: 'above' },
  { label: 'Centered on line', value: 'centered' },
]

const IMPERIAL_PRECISION_OPTIONS: Array<{
  label: string
  value: ConstructionDimensionImperialPrecision
}> = [
  { label: 'Nearest inch', value: '1' },
  { label: 'Nearest 1/2 inch', value: '1/2' },
  { label: 'Nearest 1/4 inch', value: '1/4' },
  { label: 'Nearest 1/8 inch', value: '1/8' },
  { label: 'Nearest 1/16 inch', value: '1/16' },
]

const METRIC_NOTATION_OPTIONS: Array<{
  label: string
  value: ConstructionDimensionMetricNotation
}> = [
  { label: 'Meters', value: 'meters' },
  { label: 'Millimeters', value: 'millimeters' },
]

export default function ConstructionDimensionPanel() {
  const selectedId = useViewer((state) => state.selection.selectedIds[0])
  const setSelection = useViewer((state) => state.setSelection)
  const dimension = useScene((state) => {
    const node = selectedId ? state.nodes[selectedId as AnyNodeId] : undefined
    return node?.type === 'construction-dimension' ? node : null
  })
  const foundationControllers = useScene(
    useShallow((state) =>
      Object.values(state.nodes).filter(
        (candidate): candidate is ConstructionDimensionNode =>
          candidate.type === 'construction-dimension' &&
          candidate.id !== dimension?.id &&
          candidate.drawingType === 'foundation-plan',
      ),
    ),
  )
  const updateNode = useScene((state) => state.updateNode)
  const deleteNode = useScene((state) => state.deleteNode)
  const activeDrawingType = useDrawingView((state) => state.drawingType)

  if (!(dimension && selectedId)) return null
  const update = (patch: Partial<ConstructionDimensionNode>) => updateNode(dimension.id, patch)
  const supportsCenterMark = ['radius', 'diameter', 'arc-length', 'angular'].includes(
    dimension.mode,
  )
  const activeDrawingLabel =
    DRAWING_TYPE_OPTIONS.find((option) => option.id === activeDrawingType)?.label ?? 'Floor plan'
  const activePresentation = resolveConstructionDimensionDrawingPresentation(
    dimension,
    activeDrawingType,
  )
  const activeDrawingOverride = resolveConstructionDimensionDrawingOverride(
    dimension,
    activeDrawingType,
  )
  const suppressedSegmentsText = formatSuppressedSegments(
    activeDrawingOverride?.suppressedSegmentIndexes ?? [],
  )
  const updateDrawingPresentation = (
    drawingType: ConstructionDrawingType,
    presentation: ConstructionDimensionDrawingPresentation,
  ) => {
    const drawingOverrides = setConstructionDimensionDrawingPresentation(
      dimension,
      drawingType,
      presentation,
    )
    update({
      drawingOverrides,
      ...(presentation === 'controlled' && !dimension.controllingDimensionId
        ? { controllingDimensionId: foundationControllers[0]?.id ?? null }
        : {}),
    })
  }
  const updateSuppressedSegments = (value: string) => {
    update({
      drawingOverrides: setConstructionDimensionDrawingSuppressedSegments(
        dimension,
        activeDrawingType,
        parseSuppressedSegments(value),
      ),
    })
  }

  return (
    <PanelWrapper
      icon="/icons/blueprint.webp"
      onClose={() => setSelection({ selectedIds: [] })}
      title="Construction Dimension"
      width={320}
    >
      <PanelSection title="Dimension">
        <div className="flex items-center justify-between gap-3 text-sm">
          <span className="text-muted-foreground">Mode</span>
          <span className="font-medium text-foreground">{MODE_LABELS[dimension.mode]}</span>
        </div>
        <SliderControl
          label="Feature count"
          max={999}
          min={1}
          onChange={(featureCount) => update({ featureCount })}
          precision={0}
          step={1}
          value={dimension.featureCount}
        />
        {supportsCenterMark ? (
          <label className="flex items-center justify-between gap-3 text-sm">
            <span className="text-muted-foreground">Center mark</span>
            <input
              checked={dimension.showCenterMark}
              onChange={(event) => update({ showCenterMark: event.target.checked })}
              type="checkbox"
            />
          </label>
        ) : null}
      </PanelSection>

      <PanelSection title="Drawing coordination">
        <SelectField
          label="Primary drawing"
          onChange={(drawingType) =>
            update({ drawingType: drawingType as ConstructionDrawingType })
          }
          options={DRAWING_TYPE_OPTIONS.map((option) => ({
            label: option.label,
            value: option.id,
          }))}
          value={dimension.drawingType}
        />
        <SelectField
          label={`${activeDrawingLabel} presentation`}
          onChange={(presentation) =>
            updateDrawingPresentation(
              activeDrawingType,
              presentation as ConstructionDimensionDrawingPresentation,
            )
          }
          options={[
            { label: 'Shown', value: 'shown' },
            { label: 'Omitted', value: 'omit' },
            ...(activeDrawingType === 'floor-plan'
              ? [{ label: 'Controlled by foundation', value: 'controlled' }]
              : []),
          ]}
          value={activePresentation}
        />
        {activeDrawingType === 'floor-plan' && activePresentation === 'controlled' ? (
          <SelectField
            disabled={foundationControllers.length === 0}
            label="Foundation controller"
            onChange={(controllingDimensionId) =>
              update({
                controllingDimensionId: controllingDimensionId as NonNullable<
                  ConstructionDimensionNode['controllingDimensionId']
                >,
              })
            }
            options={foundationControllers.map((controller) => ({
              label: controller.name || 'Foundation dimension',
              value: controller.id,
            }))}
            placeholder="No foundation dimensions"
            value={dimension.controllingDimensionId ?? ''}
          />
        ) : null}
        <p className="text-muted-foreground text-xs">
          Linked dimensions reuse the controller's associative anchors and update with it.
        </p>
        <TextField
          label={`${activeDrawingLabel} suppressed segments`}
          onCommit={updateSuppressedSegments}
          placeholder="e.g. 2, 4"
          value={suppressedSegmentsText}
        />
        <p className="text-muted-foreground text-xs">
          Segment numbers are one-based and apply only in this drawing view.
        </p>
      </PanelSection>

      <PanelSection title="Notation">
        <TextField
          label="Prefix"
          onCommit={(prefix) => update({ prefix })}
          value={dimension.prefix}
        />
        <TextField
          label="Suffix"
          onCommit={(suffix) => update({ suffix })}
          value={dimension.suffix}
        />
        <TextField
          label="Text override"
          onCommit={(textOverride) => update({ textOverride: textOverride || null })}
          placeholder="Use measured value"
          value={dimension.textOverride ?? ''}
        />
      </PanelSection>

      <PanelSection title="Standards">
        <SelectField
          label="Datum policy"
          onChange={(datumPolicy) =>
            update({ datumPolicy: datumPolicy as ConstructionDimensionDatumPolicy })
          }
          options={DATUM_POLICY_OPTIONS}
          value={dimension.datumPolicy}
        />
        <SelectField
          label="Terminator"
          onChange={(terminator) =>
            update({ terminator: terminator as ConstructionDimensionTerminator })
          }
          options={TERMINATOR_OPTIONS}
          value={dimension.terminator}
        />
        <SelectField
          label="Text position"
          onChange={(textPosition) =>
            update({ textPosition: textPosition as ConstructionDimensionTextPosition })
          }
          options={TEXT_POSITION_OPTIONS}
          value={dimension.textPosition}
        />
        <SelectField
          label="Imperial precision"
          onChange={(imperialPrecision) =>
            update({
              imperialPrecision: imperialPrecision as ConstructionDimensionImperialPrecision,
            })
          }
          options={IMPERIAL_PRECISION_OPTIONS}
          value={dimension.imperialPrecision}
        />
        <SelectField
          label="Metric notation"
          onChange={(metricNotation) =>
            update({ metricNotation: metricNotation as ConstructionDimensionMetricNotation })
          }
          options={METRIC_NOTATION_OPTIONS}
          value={dimension.metricNotation}
        />
        <SliderControl
          label="Extension gap"
          max={0.5}
          min={0}
          onChange={(extensionStartGap) => update({ extensionStartGap })}
          precision={3}
          step={0.005}
          value={dimension.extensionStartGap}
        />
        <SliderControl
          label="Extension overshoot"
          max={0.5}
          min={0}
          onChange={(extensionOvershoot) => update({ extensionOvershoot })}
          precision={3}
          step={0.005}
          value={dimension.extensionOvershoot}
        />
      </PanelSection>

      <PanelSection title="Actions">
        <ActionGroup>
          <ActionButton
            className="border-red-500/40 text-red-200 hover:bg-red-500/15"
            icon={<Trash2 className="h-4 w-4" />}
            label="Delete"
            onClick={() => {
              triggerSFX('sfx:structure-delete')
              deleteNode(dimension.id)
              setSelection({ selectedIds: [] })
            }}
          />
        </ActionGroup>
      </PanelSection>
    </PanelWrapper>
  )
}

function parseSuppressedSegments(value: string): number[] {
  return [
    ...new Set(
      value
        .split(/[,\s]+/)
        .map((part) => Number.parseInt(part, 10))
        .filter((index) => Number.isInteger(index) && index > 0)
        .map((index) => index - 1),
    ),
  ].sort((left, right) => left - right)
}

function formatSuppressedSegments(indexes: readonly number[]): string {
  return indexes.map((index) => index + 1).join(', ')
}

function SelectField({
  label,
  value,
  options,
  placeholder,
  disabled,
  onChange,
}: {
  label: string
  value: string
  options: Array<{ label: string; value: string }>
  placeholder?: string
  disabled?: boolean
  onChange: (value: string) => void
}) {
  return (
    <label className="space-y-1 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <select
        className="w-full rounded-md border border-border/70 bg-background px-2 py-1.5 text-foreground disabled:opacity-50"
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        value={value}
      >
        {placeholder && options.length === 0 ? <option value="">{placeholder}</option> : null}
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  )
}

function TextField({
  label,
  value,
  placeholder,
  onCommit,
}: {
  label: string
  value: string
  placeholder?: string
  onCommit: (value: string) => void
}) {
  return (
    <label className="space-y-1 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <input
        className="w-full rounded-md border border-border/70 bg-background px-2 py-1.5 text-foreground"
        defaultValue={value}
        key={value}
        onBlur={(event) => onCommit(event.target.value)}
        placeholder={placeholder}
      />
    </label>
  )
}

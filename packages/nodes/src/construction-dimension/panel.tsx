'use client'

import {
  type AnyNode,
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
  useTranslations,
} from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { Trash2 } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'

const MODE_LABEL_KEYS: Record<ConstructionDimensionNode['mode'], string> = {
  linear: 'nodes.constructionDimension.modeOptions.linear',
  radius: 'nodes.constructionDimension.modeOptions.radius',
  diameter: 'nodes.constructionDimension.modeOptions.diameter',
  'center-mark': 'nodes.constructionDimension.modeOptions.center-mark',
  chord: 'nodes.constructionDimension.modeOptions.chord',
  'arc-length': 'nodes.constructionDimension.modeOptions.arc-length',
  angular: 'nodes.constructionDimension.modeOptions.angular',
  coordinate: 'nodes.constructionDimension.modeOptions.coordinate',
}

const DATUM_POLICY_OPTIONS: Array<{
  labelKey: string
  value: ConstructionDimensionDatumPolicy
}> = [
  { labelKey: 'nodes.constructionDimension.datumPolicyOptions.centerline', value: 'centerline' },
  { labelKey: 'nodes.constructionDimension.datumPolicyOptions.wallFace', value: 'wall-face' },
  {
    labelKey: 'nodes.constructionDimension.datumPolicyOptions.structuralFace',
    value: 'structural-face',
  },
  { labelKey: 'nodes.constructionDimension.datumPolicyOptions.finishFace', value: 'finish-face' },
]

const TERMINATOR_OPTIONS: Array<{
  labelKey: string
  value: ConstructionDimensionTerminator
}> = [
  {
    labelKey: 'nodes.constructionDimension.terminatorOptions.architectural-tick',
    value: 'architectural-tick',
  },
  {
    labelKey: 'nodes.constructionDimension.terminatorOptions.filled-arrow',
    value: 'filled-arrow',
  },
  {
    labelKey: 'nodes.constructionDimension.terminatorOptions.open-arrow',
    value: 'open-arrow',
  },
  { labelKey: 'nodes.constructionDimension.terminatorOptions.dot', value: 'dot' },
]

const TEXT_POSITION_OPTIONS: Array<{
  labelKey: string
  value: ConstructionDimensionTextPosition
}> = [
  {
    labelKey: 'nodes.constructionDimension.textPositionOptions.above',
    value: 'above',
  },
  {
    labelKey: 'nodes.constructionDimension.textPositionOptions.centered',
    value: 'centered',
  },
]

const IMPERIAL_PRECISION_OPTIONS: Array<{
  labelKey: string
  value: ConstructionDimensionImperialPrecision
}> = [
  { labelKey: 'nodes.constructionDimension.imperialPrecisionOptions.1', value: '1' },
  { labelKey: 'nodes.constructionDimension.imperialPrecisionOptions.1/2', value: '1/2' },
  { labelKey: 'nodes.constructionDimension.imperialPrecisionOptions.1/4', value: '1/4' },
  { labelKey: 'nodes.constructionDimension.imperialPrecisionOptions.1/8', value: '1/8' },
  { labelKey: 'nodes.constructionDimension.imperialPrecisionOptions.1/16', value: '1/16' },
]

const METRIC_NOTATION_OPTIONS: Array<{
  labelKey: string
  value: ConstructionDimensionMetricNotation
}> = [
  {
    labelKey: 'nodes.constructionDimension.metricNotationOptions.meters',
    value: 'meters',
  },
  {
    labelKey: 'nodes.constructionDimension.metricNotationOptions.millimeters',
    value: 'millimeters',
  },
]

export default function ConstructionDimensionPanel() {
  const t = useTranslations()
  const selectedId = useViewer((state) => state.selection.selectedIds[0])
  const setSelection = useViewer((state) => state.setSelection)
  const dimension = useScene((state) => {
    const node = selectedId ? state.nodes[selectedId as AnyNodeId] : undefined
    return node?.type === 'construction-dimension' ? node : null
  })
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
  // Pass the resolved label through t() so it can also be localized if the
  // drawing-type registry ever publishes a translation key alongside `label`.
  const localizedDrawingLabel = t(activeDrawingLabel)
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
    const firstFoundationController =
      presentation === 'controlled' && !dimension.controllingDimensionId
        ? selectFoundationControllers(useScene.getState().nodes, dimension.id)[0]
        : undefined
    update({
      drawingOverrides,
      ...(presentation === 'controlled' && !dimension.controllingDimensionId
        ? { controllingDimensionId: firstFoundationController?.id ?? null }
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
      title={t('nodes.constructionDimension.fallbackTitle')}
      width={320}
    >
      <PanelSection title={t('nodes.constructionDimension.dimension')}>
        <div className="flex items-center justify-between gap-3 text-sm">
          <span className="text-muted-foreground">{t('nodes.constructionDimension.mode')}</span>
          <span className="font-medium text-foreground">{t(MODE_LABEL_KEYS[dimension.mode])}</span>
        </div>
        <SliderControl
          label={t('nodes.constructionDimension.featureCount')}
          max={999}
          min={1}
          onChange={(featureCount) => update({ featureCount })}
          precision={0}
          step={1}
          value={dimension.featureCount}
        />
        {supportsCenterMark ? (
          <label className="flex items-center justify-between gap-3 text-sm">
            <span className="text-muted-foreground">
              {t('nodes.constructionDimension.centerMark')}
            </span>
            <input
              checked={dimension.showCenterMark}
              onChange={(event) => update({ showCenterMark: event.target.checked })}
              type="checkbox"
            />
          </label>
        ) : null}
      </PanelSection>

      <PanelSection title={t('nodes.constructionDimension.drawingCoordination')}>
        <SelectField
          label={t('nodes.constructionDimension.primaryDrawing')}
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
          label={t('nodes.constructionDimension.presentation', { drawing: localizedDrawingLabel })}
          onChange={(presentation) =>
            updateDrawingPresentation(
              activeDrawingType,
              presentation as ConstructionDimensionDrawingPresentation,
            )
          }
          options={[
            { label: t('nodes.constructionDimension.presentationOptions.shown'), value: 'shown' },
            { label: t('nodes.constructionDimension.presentationOptions.omit'), value: 'omit' },
            ...(activeDrawingType === 'floor-plan'
              ? [
                  {
                    label: t('nodes.constructionDimension.presentationOptions.controlled'),
                    value: 'controlled',
                  },
                ]
              : []),
          ]}
          value={activePresentation}
        />
        {activeDrawingType === 'floor-plan' && activePresentation === 'controlled' ? (
          <FoundationControllerField
            dimensionId={dimension.id}
            onChange={(controllingDimensionId) =>
              update({
                controllingDimensionId,
              })
            }
            value={dimension.controllingDimensionId ?? ''}
          />
        ) : null}
        <p className="text-muted-foreground text-xs">
          {t('nodes.constructionDimension.linkedDimensionsNote')}
        </p>
        <TextField
          label={t('nodes.constructionDimension.suppressedSegments', { drawing: localizedDrawingLabel })}
          onCommit={updateSuppressedSegments}
          placeholder={t('nodes.constructionDimension.suppressedSegmentsPlaceholder')}
          value={suppressedSegmentsText}
        />
        <p className="text-muted-foreground text-xs">
          {t('nodes.constructionDimension.suppressedSegmentsNote')}
        </p>
      </PanelSection>

      <PanelSection title={t('nodes.constructionDimension.notation')}>
        <TextField
          label={t('nodes.constructionDimension.prefix')}
          onCommit={(prefix) => update({ prefix })}
          value={dimension.prefix}
        />
        <TextField
          label={t('nodes.constructionDimension.suffix')}
          onCommit={(suffix) => update({ suffix })}
          value={dimension.suffix}
        />
        <TextField
          label={t('nodes.constructionDimension.textOverride')}
          onCommit={(textOverride) => update({ textOverride: textOverride || null })}
          placeholder={t('nodes.constructionDimension.textOverridePlaceholder')}
          value={dimension.textOverride ?? ''}
        />
      </PanelSection>

      <PanelSection title={t('nodes.constructionDimension.standards')}>
        <SelectField
          label={t('nodes.constructionDimension.datumPolicy')}
          onChange={(datumPolicy) =>
            update({ datumPolicy: datumPolicy as ConstructionDimensionDatumPolicy })
          }
          options={DATUM_POLICY_OPTIONS.map((o) => ({ label: t(o.labelKey), value: o.value }))}
          value={dimension.datumPolicy}
        />
        <SelectField
          label={t('nodes.constructionDimension.terminator')}
          onChange={(terminator) =>
            update({ terminator: terminator as ConstructionDimensionTerminator })
          }
          options={TERMINATOR_OPTIONS.map((o) => ({ label: t(o.labelKey), value: o.value }))}
          value={dimension.terminator}
        />
        <SelectField
          label={t('nodes.constructionDimension.textPosition')}
          onChange={(textPosition) =>
            update({ textPosition: textPosition as ConstructionDimensionTextPosition })
          }
          options={TEXT_POSITION_OPTIONS.map((o) => ({ label: t(o.labelKey), value: o.value }))}
          value={dimension.textPosition}
        />
        <SelectField
          label={t('nodes.constructionDimension.imperialPrecision')}
          onChange={(imperialPrecision) =>
            update({
              imperialPrecision: imperialPrecision as ConstructionDimensionImperialPrecision,
            })
          }
          options={IMPERIAL_PRECISION_OPTIONS.map((o) => ({
            label: t(o.labelKey),
            value: o.value,
          }))}
          value={dimension.imperialPrecision}
        />
        <SelectField
          label={t('nodes.constructionDimension.metricNotation')}
          onChange={(metricNotation) =>
            update({ metricNotation: metricNotation as ConstructionDimensionMetricNotation })
          }
          options={METRIC_NOTATION_OPTIONS.map((o) => ({
            label: t(o.labelKey),
            value: o.value,
          }))}
          value={dimension.metricNotation}
        />
        <SliderControl
          label={t('nodes.constructionDimension.extensionGap')}
          max={0.5}
          min={0}
          onChange={(extensionStartGap) => update({ extensionStartGap })}
          precision={3}
          step={0.005}
          value={dimension.extensionStartGap}
        />
        <SliderControl
          label={t('nodes.constructionDimension.extensionOvershoot')}
          max={0.5}
          min={0}
          onChange={(extensionOvershoot) => update({ extensionOvershoot })}
          precision={3}
          step={0.005}
          value={dimension.extensionOvershoot}
        />
      </PanelSection>

      <PanelSection title={t('nodes.constructionDimension.actions')}>
        <ActionGroup>
          <ActionButton
            className="border-red-500/40 text-red-200 hover:bg-red-500/15"
            icon={<Trash2 className="h-4 w-4" />}
            label={t('common.delete')}
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

function selectFoundationControllers(
  nodes: Record<string, AnyNode>,
  excludedId: AnyNodeId,
): ConstructionDimensionNode[] {
  return Object.values(nodes).filter(
    (candidate): candidate is ConstructionDimensionNode =>
      candidate.type === 'construction-dimension' &&
      candidate.id !== excludedId &&
      candidate.drawingType === 'foundation-plan',
  )
}

function FoundationControllerField({
  dimensionId,
  value,
  onChange,
}: {
  dimensionId: AnyNodeId
  value: string
  onChange: (value: NonNullable<ConstructionDimensionNode['controllingDimensionId']>) => void
}) {
  const t = useTranslations()
  const foundationControllers = useScene(
    useShallow((state) => selectFoundationControllers(state.nodes, dimensionId)),
  )
  return (
    <SelectField
      disabled={foundationControllers.length === 0}
      label={t('nodes.constructionDimension.foundationController')}
      onChange={(controllingDimensionId) =>
        onChange(
          controllingDimensionId as NonNullable<
            ConstructionDimensionNode['controllingDimensionId']
          >,
        )
      }
      options={foundationControllers.map((controller) => ({
        label: controller.name || t('nodes.constructionDimension.defaultFoundationDimensionName'),
        value: controller.id,
      }))}
      placeholder={t('nodes.constructionDimension.noFoundationDimensions')}
      value={value}
    />
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

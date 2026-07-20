'use client'

import {
  type AnyNodeId,
  type ConstructionDimensionDrawingPresentation,
  type ConstructionDimensionNode,
  type ConstructionDrawingType,
  resolveConstructionDimensionDrawingPresentation,
  setConstructionDimensionDrawingPresentation,
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

export default function ConstructionDimensionPanel() {
  const selectedId = useViewer((state) => state.selection.selectedIds[0])
  const setSelection = useViewer((state) => state.setSelection)
  const nodes = useScene((state) => state.nodes)
  const node = selectedId ? nodes[selectedId as AnyNodeId] : undefined
  const updateNode = useScene((state) => state.updateNode)
  const deleteNode = useScene((state) => state.deleteNode)
  const activeDrawingType = useDrawingView((state) => state.drawingType)
  const dimension = node?.type === 'construction-dimension' ? node : null

  if (!(dimension && selectedId)) return null
  const update = (patch: Partial<ConstructionDimensionNode>) => updateNode(dimension.id, patch)
  const supportsCenterMark = ['radius', 'diameter', 'arc-length', 'angular'].includes(
    dimension.mode,
  )
  const foundationControllers = Object.values(nodes).filter(
    (candidate): candidate is ConstructionDimensionNode =>
      candidate.type === 'construction-dimension' &&
      candidate.id !== dimension.id &&
      candidate.drawingType === 'foundation-plan',
  )
  const activeDrawingLabel =
    DRAWING_TYPE_OPTIONS.find((option) => option.id === activeDrawingType)?.label ?? 'Floor plan'
  const activePresentation = resolveConstructionDimensionDrawingPresentation(
    dimension,
    activeDrawingType,
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
        <label className="flex items-center justify-between gap-3 text-sm">
          <span className="text-muted-foreground">Reference notation</span>
          <input
            checked={dimension.reference}
            onChange={(event) => update({ reference: event.target.checked })}
            type="checkbox"
          />
        </label>
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
            { label: 'Reference', value: 'reference' },
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

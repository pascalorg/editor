'use client'

import {
  DYNAMIC_TYPE_LABELS,
  type DynamicBinding,
  type DynamicConveyorEndpointBehavior,
  type DynamicType,
  useScene,
} from '@pascal-app/core'
import { CircleHelp, Trash2 } from 'lucide-react'
import { useMemo, type ReactNode } from 'react'
import { AXIS_OPTIONS, createBinding, PREVIEW_RUNTIME_TYPES } from './binding-defaults'
import { NumberField, type PathOption, SelectField, TextField } from './fields'
import { validateDynamicBinding, type DynamicBindingValidationIssue } from './validation'

const zh = (...codes: number[]) => String.fromCodePoint(...codes)

const LABELS = {
  axis: zh(0x8f74, 0x5411),
  animationSpeed: zh(0x52a8, 0x753b, 0x901f, 0x5ea6),
  arrowColor: zh(0x7bad, 0x5934, 0x989c, 0x8272),
  arrowColorDesc: zh(
    0x4ec5,
    0x63a7,
    0x5236,
    0x6d41,
    0x5411,
    0x7bad,
    0x5934,
    0xff0c,
    0x4e0d,
    0x5f71,
    0x54cd,
    0x6db2,
    0x4f53,
  ),
  closeAngle: zh(0x95ed, 0x5408, 0x89d2, 0x5ea6),
  color: zh(0x989c, 0x8272),
  colorMode: zh(0x989c, 0x8272, 0x65b9, 0x5f0f),
  conditionColor: zh(0x6761, 0x4ef6, 0x53d8, 0x8272),
  conveyorAccumulate: zh(0x5230, 0x672b, 0x7aef, 0x505c, 0x7559),
  conveyorCadence: zh(0x4e0a, 0x6599, 0x8282, 0x62cd),
  conveyorContinue: zh(0x7ee7, 0x7eed, 0x4e0b, 0x4e00, 0x6bb5),
  conveyorDistance: zh(0x8f93, 0x9001, 0x8ddd, 0x79bb),
  conveyorEndpointBehavior: zh(0x7ec8, 0x70b9, 0x884c, 0x4e3a),
  conveyorLoop: zh(0x5faa, 0x73af),
  conveyorMaxItems: zh(0x6700, 0x591a, 0x8d27, 0x7269),
  conveyorParams: zh(0x8f93, 0x9001, 0x53c2, 0x6570),
  conveyorRemoveAtEnd: zh(0x5230, 0x672b, 0x7aef, 0x6d88, 0x5931),
  conveyorUnavailable: zh(
    0x8f93,
    0x9001,
    0x914d,
    0x7f6e,
    0x4ec5,
    0x5bf9,
    0x8f93,
    0x9001,
    0x5e26,
    0x8bbe,
    0x5907,
    0x663e,
    0x793a,
    0x3002,
  ),
  data: zh(0x6570, 0x636e),
  dataMapping: zh(0x6570, 0x636e, 0x6620, 0x5c04),
  dataPath: zh(0x6570, 0x636e, 0x8def, 0x5f84),
  defaultCargo: zh(0x9ed8, 0x8ba4, 0x8d27, 0x7269),
  deleteDynamic: zh(0x5220, 0x9664, 0x52a8, 0x6001),
  dynamicType: zh(0x52a8, 0x6001, 0x7c7b, 0x578b),
  emptyTankValue: zh(0x7a7a, 0x7f50, 0x503c),
  endColor: zh(0x7ed3, 0x675f, 0x989c, 0x8272),
  equalsCondition: zh(0x7b49, 0x4e8e, 0x6307, 0x5b9a, 0x503c),
  flowDirection: zh(0x6d41, 0x52a8, 0x65b9, 0x5411),
  flowMedium: zh(0x4ecb, 0x8d28, 0x7c7b, 0x578b),
  fullTankValue: zh(0x6ee1, 0x7f50, 0x503c),
  greaterThan: zh(0x9ad8, 0x4e8e, 0x9608, 0x503c),
  inputMax: zh(0x8f93, 0x5165, 0x6700, 0x5927),
  inputMin: zh(0x8f93, 0x5165, 0x6700, 0x5c0f),
  itemSpacing: zh(0x8d27, 0x7269, 0x95f4, 0x8ddd),
  itemTemplate: zh(0x8d27, 0x7269, 0x6a21, 0x677f, 0x8282, 0x70b9, 0x20, 0x49, 0x44),
  itemTemplatePlaceholder: zh(
    0x4e0d,
    0x9009,
    0x5219,
    0x4f7f,
    0x7528,
    0x9ed8,
    0x8ba4,
    0x8d27,
    0x7269,
  ),
  lessThan: zh(0x4f4e, 0x4e8e, 0x9608, 0x503c),
  liquid: zh(0x6db2, 0x4f53),
  liquidColor: zh(0x6db2, 0x4f53, 0x989c, 0x8272),
  liquidColorDesc: zh(0x7ba1, 0x5185, 0x586b, 0x5145, 0x4e0e, 0x6db2, 0x4f53, 0x6548, 0x679c),
  motionMode: zh(0x8fd0, 0x52a8, 0x65b9, 0x5f0f),
  motionParams: zh(0x8fd0, 0x52a8, 0x53c2, 0x6570),
  move: zh(0x79fb, 0x52a8),
  moveStyle: zh(0x79fb, 0x52a8, 0x5f62, 0x5f0f),
  openAngle: zh(0x6253, 0x5f00, 0x89d2, 0x5ea6),
  outputMax: zh(0x8f93, 0x51fa, 0x6700, 0x5927),
  outputMin: zh(0x8f93, 0x51fa, 0x6700, 0x5c0f),
  pulseSpeed: zh(0x8109, 0x51b2, 0x901f, 0x5ea6),
  realtimeFollow: zh(0x5b9e, 0x65f6, 0x8ddf, 0x968f),
  roll: zh(0x6eda, 0x52a8),
  scaleEffect: zh(0x7f29, 0x653e, 0x6548, 0x679c),
  scaleMax: zh(0x7f29, 0x653e, 0x6700, 0x5927),
  scaleMin: zh(0x7f29, 0x653e, 0x6700, 0x5c0f),
  scaleMultiplier: zh(0x7f29, 0x653e, 0x500d, 0x6570),
  smoothFollow: zh(0x5e73, 0x6ed1, 0x8ddf, 0x968f),
  speedMax: zh(0x901f, 0x5ea6, 0x6700, 0x5927),
  speedMin: zh(0x901f, 0x5ea6, 0x6700, 0x5c0f),
  startColor: zh(0x8d77, 0x59cb, 0x989c, 0x8272),
  steam: zh(0x84b8, 0x6c7d),
  targetColor: zh(0x76ee, 0x6807, 0x989c, 0x8272),
  targetValue: zh(0x76ee, 0x6807, 0x503c),
  threshold: zh(0x9608, 0x503c),
  translate: zh(0x5e73, 0x79fb),
  validationOk: zh(0x914d, 0x7f6e, 0x6821, 0x9a8c, 0x901a, 0x8fc7, 0x3002),
}

const CONVEYOR_ENDPOINT_BEHAVIOR_OPTIONS: DynamicConveyorEndpointBehavior[] = [
  'loop',
  'disappear',
  'continue',
  'accumulate',
]

const CONVEYOR_ENDPOINT_BEHAVIOR_LABELS: Record<DynamicConveyorEndpointBehavior, string> = {
  loop: LABELS.conveyorLoop,
  disappear: LABELS.conveyorRemoveAtEnd,
  continue: LABELS.conveyorContinue,
  accumulate: LABELS.conveyorAccumulate,
}

function isCargoTemplateCandidate(node: { id: string; type?: string }) {
  return !['conveyor-belt', 'pipe', 'level', 'building', 'site', 'zone'].includes(node.type ?? '')
}

function nodeDisplayName(node: { id: string; name?: string; label?: string; type?: string }) {
  return node.name || node.label || `${node.type ?? 'node'} · ${node.id}`
}

function BindingSection({
  children,
  testId,
  title,
  showTitle = true,
}: {
  children: ReactNode
  testId: string
  title: string
  showTitle?: boolean
}) {
  return (
    <div className="flex flex-col gap-2 rounded-md border border-border/30 bg-black/10 p-2" data-testid={testId}>
      {showTitle ? (
        <div className="font-medium text-[10px] text-muted-foreground uppercase tracking-wide">{title}</div>
      ) : null}
      {children}
    </div>
  )
}

function hasInputRange(binding: DynamicBinding, showConveyorSettings: boolean) {
  return (
    ['move', 'scale', 'fill', 'level', 'rotate', 'speed', 'flow', 'brightness', 'color'].includes(binding.type) ||
    showConveyorSettings
  )
}

function hasOutputRange(binding: DynamicBinding) {
  return binding.type === 'scale' || binding.type === 'move' || binding.type === 'level'
}

function hasMotionSection(binding: DynamicBinding, showConveyorSettings: boolean) {
  return (
    binding.type === 'rotate' ||
    binding.type === 'speed' ||
    binding.type === 'move' ||
    binding.type === 'scale' ||
    binding.type === 'level' ||
    binding.type === 'fill' ||
    binding.type === 'flow' ||
    binding.type === 'openClose' ||
    showConveyorSettings
  )
}

function hasColorSection(binding: DynamicBinding) {
  return ['color', 'blink', 'flow', 'brightness'].includes(binding.type)
}

function ValidationIssues({ issues }: { issues: DynamicBindingValidationIssue[] }) {
  if (issues.length === 0) {
    return (
      <div
        className="rounded-md border border-emerald-400/15 bg-emerald-400/10 px-2 py-1 text-[10px] text-emerald-200"
        data-testid="dynamic-validation-ok"
      >
        {LABELS.validationOk}
      </div>
    )
  }

  return (
    <div
      className="flex flex-col gap-1 rounded-md border border-amber-400/20 bg-amber-400/10 px-2 py-1"
      data-testid="dynamic-validation-issues"
    >
      {issues.map((issue, index) => (
        <div
          className={
            issue.severity === 'error'
              ? 'text-red-200 text-[10px]'
              : issue.severity === 'warning'
                ? 'text-amber-200 text-[10px]'
                : 'text-muted-foreground text-[10px]'
          }
          data-testid={`dynamic-validation-${issue.severity}`}
          key={`${issue.severity}:${issue.message}:${index}`}
        >
          {issue.message}
        </div>
      ))}
    </div>
  )
}

function parseEqualsValue(value: string): string | number | boolean {
  const trimmed = value.trim()
  if (trimmed === 'true') return true
  if (trimmed === 'false') return false
  if (trimmed !== '' && Number.isFinite(Number(trimmed))) return Number(trimmed)
  return value
}

type DynamicCondition = NonNullable<DynamicBinding['condition']>
type ConditionalDynamicType = Extract<DynamicType, 'visible' | 'blink' | 'color' | 'scale'>

const CONDITION_OPTIONS: DynamicCondition[] = ['truthy', 'greaterThan', 'lessThan', 'equals']

const TRUTHY_CONDITION_LABELS: Record<ConditionalDynamicType, string> = {
  visible: zh(0x662f, 0x5426, 0x53ef, 0x89c1),
  blink: zh(0x662f, 0x5426, 0x95ea, 0x70c1),
  color: zh(0x662f, 0x5426, 0x53d8, 0x8272),
  scale: zh(0x662f, 0x5426, 0x7f29, 0x653e),
}

const CONDITION_FIELD_LABELS: Record<ConditionalDynamicType, string> = {
  visible: zh(0x53ef, 0x89c1, 0x6761, 0x4ef6),
  blink: zh(0x95ea, 0x70c1, 0x6761, 0x4ef6),
  color: zh(0x53d8, 0x8272, 0x6761, 0x4ef6),
  scale: zh(0x7f29, 0x653e, 0x6761, 0x4ef6),
}

function conditionLabel(type: ConditionalDynamicType, condition: DynamicCondition) {
  if (condition === 'truthy') return TRUTHY_CONDITION_LABELS[type]
  if (condition === 'greaterThan') return LABELS.greaterThan
  if (condition === 'lessThan') return LABELS.lessThan
  return LABELS.equalsCondition
}

function DynamicConditionFields({
  binding,
  type,
  testId,
  onChange,
}: {
  binding: DynamicBinding
  type: ConditionalDynamicType
  testId: string
  onChange: (binding: DynamicBinding) => void
}) {
  const condition: DynamicCondition =
    binding.condition === 'greaterThan' || binding.condition === 'lessThan' || binding.condition === 'equals'
      ? binding.condition
      : 'truthy'

  return (
    <div className="flex flex-col gap-2" data-testid={testId}>
      <SelectField
        getLabel={(item) => conditionLabel(type, item)}
        label={CONDITION_FIELD_LABELS[type]}
        onChange={(nextCondition) => {
          if (nextCondition === 'truthy') {
            onChange({ ...binding, condition: 'truthy', value: undefined })
            return
          }
          if (nextCondition === 'greaterThan' || nextCondition === 'lessThan') {
            onChange({
              ...binding,
              condition: nextCondition,
              value: typeof binding.value === 'number' ? binding.value : 0,
            })
            return
          }
          onChange({ ...binding, condition: 'equals', value: binding.value ?? true })
        }}
        options={CONDITION_OPTIONS}
        testId={`dynamic-${type}-condition-select`}
        value={condition}
      />
      {condition === 'greaterThan' || condition === 'lessThan' ? (
        <NumberField
          label={LABELS.threshold}
          onChange={(value) => onChange({ ...binding, value })}
          value={typeof binding.value === 'number' ? binding.value : 0}
        />
      ) : null}
      {condition === 'equals' ? (
        <TextField
          label={LABELS.targetValue}
          onChange={(value) => onChange({ ...binding, value: parseEqualsValue(value) })}
          placeholder="例如 true / 1 / warning"
          value={String(binding.value ?? '')}
        />
      ) : null}
    </div>
  )
}

function CompactNumberInput({
  label,
  value,
  onChange,
}: {
  label: string
  value: number
  onChange: (value: number) => void
}) {
  return (
    <label className="min-w-0 flex-1">
      <span className="sr-only">{label}</span>
      <input
        aria-label={label}
        className="h-7 w-full rounded-md border border-border/50 bg-[#2C2C2E] px-1.5 text-center text-[11px] text-foreground"
        onChange={(event) => onChange(Number(event.target.value))}
        step={0.1}
        type="number"
        value={value}
      />
    </label>
  )
}

function ColorInput({
  label,
  value,
  onChange,
}: {
  label: string
  value: string
  onChange: (value: string) => void
}) {
  return (
    <label className="flex flex-col gap-1 text-muted-foreground text-xs">
      {label}
      <input
        className="h-8 rounded-md border border-border/50 bg-[#2C2C2E] px-2"
        onChange={(event) => onChange(event.target.value)}
        type="color"
        value={value}
      />
    </label>
  )
}

function FlowColorInput({
  description,
  label,
  value,
  onChange,
}: {
  description: string
  label: string
  value: string
  onChange: (value: string) => void
}) {
  return (
    <label className="flex items-center justify-between gap-3 rounded-md border border-border/35 bg-[#2C2C2E]/70 px-2.5 py-2">
      <span className="min-w-0">
        <span className="block font-medium text-[11px] text-foreground">{label}</span>
        <span className="block truncate text-[10px] text-muted-foreground">{description}</span>
      </span>
      <span className="flex shrink-0 items-center gap-2">
        <input
          aria-label={label}
          className="h-7 w-9 cursor-pointer rounded border border-border/50 bg-transparent p-0.5"
          onChange={(event) => onChange(event.target.value)}
          type="color"
          value={value}
        />
        <span className="w-[58px] rounded bg-black/20 px-1.5 py-1 text-center font-mono text-[10px] text-muted-foreground uppercase">
          {value}
        </span>
      </span>
    </label>
  )
}

function MoveRangeRow({
  binding,
  updateRange,
}: {
  binding: DynamicBinding
  updateRange: (key: 'inputRange' | 'outputRange' | 'speedRange', index: 0 | 1, value: number) => void
}) {
  return (
    <div className="grid grid-cols-2 gap-x-2 gap-y-1" data-testid="dynamic-move-range-row">
      <div className="text-muted-foreground text-[11px]">{LABELS.data}</div>
      <div className="flex items-center gap-1 text-muted-foreground text-[11px]">
        <span>{LABELS.move}</span>
        <span className="group relative inline-flex h-4 w-4 items-center justify-center rounded-full text-muted-foreground/80">
          <CircleHelp className="h-3 w-3" />
          <span className="pointer-events-none absolute right-0 bottom-full z-20 mb-1 hidden w-48 rounded-md border border-border/60 bg-[#2C2C2E] px-2 py-1.5 text-left text-[10px] leading-4 text-foreground shadow-xl group-hover:block">
            数据 0 到 100，对应移动 0 到 2 米；数据为 50 时，物体移动 1 米。
          </span>
        </span>
      </div>
      <div className="flex items-center gap-1 text-muted-foreground text-[10px]">
        <CompactNumberInput
          label={LABELS.inputMin}
          onChange={(value) => updateRange('inputRange', 0, value)}
          value={binding.inputRange?.[0] ?? 0}
        />
        <span className="shrink-0">-</span>
        <CompactNumberInput
          label={LABELS.inputMax}
          onChange={(value) => updateRange('inputRange', 1, value)}
          value={binding.inputRange?.[1] ?? 100}
        />
      </div>
      <div className="flex items-center gap-1 text-muted-foreground text-[10px]">
        <CompactNumberInput
          label={LABELS.outputMin}
          onChange={(value) => updateRange('outputRange', 0, value)}
          value={binding.outputRange?.[0] ?? 0}
        />
        <span className="shrink-0">-</span>
        <CompactNumberInput
          label={LABELS.outputMax}
          onChange={(value) => updateRange('outputRange', 1, value)}
          value={binding.outputRange?.[1] ?? 1}
        />
        <span className="shrink-0">m</span>
      </div>
    </div>
  )
}

export function DynamicBindingCard({
  binding,
  dynamicTypes,
  isConveyorNode,
  isPipeNode,
  pathOptions,
  onChange,
  onRemove,
}: {
  binding: DynamicBinding
  dynamicTypes: DynamicType[]
  isConveyorNode: boolean
  isPipeNode: boolean
  pathOptions: PathOption[]
  onChange: (binding: DynamicBinding) => void
  onRemove: () => void
}) {
  const previewSupported = PREVIEW_RUNTIME_TYPES.has(binding.type)
  const pathValues = pathOptions.map((option) => option.path)
  const selectPathOptions = pathValues.includes(binding.path) ? pathValues : [binding.path, ...pathValues]
  const selectDynamicTypes = dynamicTypes.includes(binding.type) ? dynamicTypes : [binding.type, ...dynamicTypes]
  const showConveyorSettings = binding.type === 'conveyorFlow' && isConveyorNode
  const validationIssues = validateDynamicBinding({ binding, isConveyorNode, pathOptions })
  const sceneNodes = useScene((state) => state.nodes)
  const cargoTemplateOptions = useMemo(
    () =>
      Object.values(sceneNodes)
        .filter(isCargoTemplateCandidate)
        .map((node) => String(node.id)),
    [sceneNodes],
  )
  const cargoTemplateLabels = useMemo(() => {
    const labels: Record<string, string> = {}
    for (const node of Object.values(sceneNodes)) {
      if (isCargoTemplateCandidate(node)) labels[node.id] = nodeDisplayName(node)
    }
    return labels
  }, [sceneNodes])
  const selectedCargoTemplate = binding.itemTemplateNodeId ?? ''
  const cargoTemplateSelectOptions = (selectedCargoTemplate && !cargoTemplateOptions.includes(selectedCargoTemplate))
    ? [selectedCargoTemplate, ...cargoTemplateOptions]
    : cargoTemplateOptions

  const updateRange = (
    key: 'inputRange' | 'outputRange' | 'speedRange',
    index: 0 | 1,
    value: number,
  ) => {
    const current = binding[key] ?? [0, 100]
    onChange({
      ...binding,
      [key]: [index === 0 ? value : current[0], index === 1 ? value : current[1]],
    })
  }

  return (
    <div
      className="flex flex-col gap-2 rounded-lg border border-border/45 bg-[#252527] p-2"
      data-testid="dynamic-binding-card"
    >
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <SelectField
            getLabel={(type) => DYNAMIC_TYPE_LABELS[type] ?? type}
            hideLabel
            label={LABELS.dynamicType}
            onChange={(type) => onChange({ ...createBinding(type, binding.path), id: binding.id })}
            options={selectDynamicTypes}
            testId="dynamic-binding-type-select"
            value={binding.type}
          />
        </div>
        <button
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition hover:bg-red-500/15 hover:text-red-300"
          onClick={onRemove}
          title={LABELS.deleteDynamic}
          type="button"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>

      {!previewSupported ? (
        <div className="rounded-md border border-amber-400/20 bg-amber-400/10 px-2 py-1 text-[10px] text-amber-200">
          该动态可以保存配置，但预览运行效果还未接入。
        </div>
      ) : null}

      <BindingSection showTitle={false} testId="dynamic-section-data-mapping" title={LABELS.dataMapping}>
        <SelectField
          getLabel={(path) => pathOptions.find((option) => option.path === path)?.label ?? path}
          label={LABELS.dataPath}
          onChange={(path) => onChange({ ...binding, path })}
          options={selectPathOptions}
          testId="dynamic-binding-path-select"
          value={binding.path}
        />
        {binding.type === 'visible' ? (
          <DynamicConditionFields
            binding={binding}
            onChange={onChange}
            testId="dynamic-visible-condition"
            type="visible"
          />
        ) : null}
        {binding.type === 'blink' || binding.type === 'scale' || (binding.type === 'color' && binding.colorMode !== 'gradient') ? (
          <DynamicConditionFields
            binding={binding}
            onChange={onChange}
            testId={`dynamic-${binding.type}-condition`}
            type={binding.type}
          />
        ) : null}
        {hasInputRange(binding, showConveyorSettings) &&
        binding.type !== 'move' &&
        !(binding.type === 'scale' && binding.condition) &&
        !(binding.type === 'color' && binding.colorMode !== 'gradient') ? (
          <div className="grid grid-cols-2 gap-2">
            <NumberField
              label={binding.type === 'fill' || binding.type === 'level' ? LABELS.emptyTankValue : LABELS.inputMin}
              onChange={(value) => updateRange('inputRange', 0, value)}
              value={binding.inputRange?.[0] ?? 0}
            />
            <NumberField
              label={binding.type === 'fill' || binding.type === 'level' ? LABELS.fullTankValue : LABELS.inputMax}
              onChange={(value) => updateRange('inputRange', 1, value)}
              value={binding.inputRange?.[1] ?? 100}
            />
          </div>
        ) : null}
      </BindingSection>

      {hasMotionSection(binding, showConveyorSettings) ? (
        <BindingSection testId="dynamic-section-motion" title={LABELS.motionParams}>
          {(binding.type === 'rotate' ||
            binding.type === 'speed' ||
            binding.type === 'move' ||
            binding.type === 'openClose') && (
            <SelectField
              label={LABELS.axis}
              onChange={(axis) => onChange({ ...binding, axis })}
              options={AXIS_OPTIONS}
              value={binding.axis ?? 'y'}
            />
          )}
          {binding.type === 'flow' && isPipeNode ? (
            <>
              <SelectField
                getLabel={(medium) => (medium === 'steam' ? LABELS.steam : LABELS.liquid)}
                label={LABELS.flowMedium}
                onChange={(flowMedium) => onChange({ ...binding, flowMedium })}
                options={['steam', 'liquid']}
                testId="dynamic-flow-medium-select"
                value={binding.flowMedium === 'steam' ? 'steam' : 'liquid'}
              />
              <SelectField
                getLabel={(direction) => (direction === 'backward' ? '反向' : '正向')}
                label={LABELS.flowDirection}
                onChange={(direction) => onChange({ ...binding, direction })}
                options={['forward', 'backward']}
                testId="dynamic-flow-direction-select"
                value={binding.direction === 'backward' ? 'backward' : 'forward'}
              />
            </>
          ) : null}
          {binding.type === 'move' ? (
            <>
              <SelectField
                getLabel={(mode) => (mode === 'smooth' ? LABELS.smoothFollow : LABELS.realtimeFollow)}
                label={LABELS.motionMode}
                onChange={(motionMode) => onChange({ ...binding, motionMode })}
                options={['follow', 'smooth']}
                testId="dynamic-move-motion-mode-select"
                value={binding.motionMode === 'smooth' ? 'smooth' : 'follow'}
              />
              <SelectField
                getLabel={(style) => (style === 'roll' ? LABELS.roll : LABELS.translate)}
                label={LABELS.moveStyle}
                onChange={(moveStyle) => onChange({ ...binding, moveStyle })}
                options={['translate', 'roll']}
                testId="dynamic-move-style-select"
                value={binding.moveStyle === 'roll' ? 'roll' : 'translate'}
              />
              <MoveRangeRow binding={binding} updateRange={updateRange} />
            </>
          ) : null}
          {binding.type === 'scale' && binding.condition ? (
            <>
              <SelectField
                getLabel={(effect) =>
                  effect === 'pulse' ? '脉冲缩放' : effect === 'alarmPulse' ? '报警脉冲' : '固定缩放'
                }
                label={LABELS.scaleEffect}
                onChange={(scaleEffect) =>
                  onChange({
                    ...binding,
                    scaleEffect,
                    outputRange:
                      scaleEffect === 'fixed'
                        ? [binding.outputRange?.[0] ?? 1, binding.outputRange?.[1] ?? 1.2]
                        : [binding.outputRange?.[0] ?? 1, binding.outputRange?.[1] ?? 1.25],
                    speedRange: scaleEffect === 'fixed' ? binding.speedRange : [0, binding.speedRange?.[1] ?? 4],
                  })
                }
                options={['fixed', 'pulse', 'alarmPulse']}
                testId="dynamic-scale-effect-select"
                value={binding.scaleEffect === 'pulse' || binding.scaleEffect === 'alarmPulse' ? binding.scaleEffect : 'fixed'}
              />
              {binding.scaleEffect === 'pulse' || binding.scaleEffect === 'alarmPulse' ? (
                <>
                  <div className="grid grid-cols-2 gap-2">
                    <NumberField
                      label={LABELS.scaleMin}
                      onChange={(value) => updateRange('outputRange', 0, value)}
                      value={binding.outputRange?.[0] ?? 1}
                    />
                    <NumberField
                      label={LABELS.scaleMax}
                      onChange={(value) => updateRange('outputRange', 1, value)}
                      value={binding.outputRange?.[1] ?? 1.25}
                    />
                  </div>
                  <NumberField
                    label={LABELS.pulseSpeed}
                    onChange={(value) => updateRange('speedRange', 1, value)}
                    value={binding.speedRange?.[1] ?? (binding.scaleEffect === 'alarmPulse' ? 8 : 4)}
                  />
                </>
              ) : (
                <NumberField
                  label={LABELS.scaleMultiplier}
                  onChange={(value) => updateRange('outputRange', 1, value)}
                  value={binding.outputRange?.[1] ?? 1.2}
                />
              )}
            </>
          ) : null}
          {hasOutputRange(binding) && binding.type !== 'move' && !(binding.type === 'scale' && binding.condition) ? (
            <div className="grid grid-cols-2 gap-2">
              <NumberField
                label={binding.type === 'scale' ? LABELS.scaleMin : LABELS.outputMin}
                onChange={(value) => updateRange('outputRange', 0, value)}
                value={binding.outputRange?.[0] ?? (binding.type === 'scale' ? 0.5 : 0)}
              />
              <NumberField
                label={binding.type === 'scale' ? LABELS.scaleMax : LABELS.outputMax}
                onChange={(value) => updateRange('outputRange', 1, value)}
                value={binding.outputRange?.[1] ?? (binding.type === 'scale' ? 1.5 : 1)}
              />
            </div>
          ) : null}
          {(binding.type === 'rotate' || binding.type === 'speed' || showConveyorSettings) ? (
            <div className="grid grid-cols-2 gap-2">
              <NumberField
                label={LABELS.speedMin}
                onChange={(value) => updateRange('speedRange', 0, value)}
                value={binding.speedRange?.[0] ?? 0}
              />
              <NumberField
                label={LABELS.speedMax}
                onChange={(value) => updateRange('speedRange', 1, value)}
                value={binding.speedRange?.[1] ?? (showConveyorSettings ? 2 : 6)}
              />
            </div>
          ) : null}
          {binding.type === 'flow' ? (
            <NumberField
              label={LABELS.animationSpeed}
              onChange={(value) => updateRange('speedRange', 1, value)}
              value={binding.speedRange?.[1] ?? 1.2}
            />
          ) : null}
          {binding.type === 'openClose' ? (
            <div className="grid grid-cols-2 gap-2">
              <NumberField
                label={LABELS.closeAngle}
                onChange={(value) => updateRange('outputRange', 0, value)}
                value={binding.outputRange?.[0] ?? 0}
              />
              <NumberField
                label={LABELS.openAngle}
                onChange={(value) => updateRange('outputRange', 1, value)}
                value={binding.outputRange?.[1] ?? Math.PI / 2}
              />
            </div>
          ) : null}
        </BindingSection>
      ) : null}

      {hasColorSection(binding) ? (
        <BindingSection showTitle={false} testId="dynamic-section-color" title={LABELS.color}>
          {binding.type === 'color' ? (
            <SelectField
              getLabel={(mode) => (mode === 'gradient' ? '数值渐变' : LABELS.conditionColor)}
              label={LABELS.colorMode}
              onChange={(colorMode) =>
                onChange({
                  ...binding,
                  colorMode,
                  condition: colorMode === 'gradient' ? undefined : (binding.condition ?? 'truthy'),
                  inputRange: colorMode === 'gradient' ? (binding.inputRange ?? [0, 100]) : binding.inputRange,
                  color: binding.color ?? (colorMode === 'gradient' ? '#35c8ff' : '#ff3b30'),
                  endColor: colorMode === 'gradient' ? (binding.endColor ?? '#ff3b30') : binding.endColor,
                })
              }
              options={['condition', 'gradient']}
              testId="dynamic-color-mode-select"
              value={binding.colorMode === 'gradient' ? 'gradient' : 'condition'}
            />
          ) : null}
          {binding.type === 'flow' ? (
            <div className="flex flex-col gap-1.5">
              <FlowColorInput
                description={LABELS.liquidColorDesc}
                label={LABELS.liquidColor}
                onChange={(color) => onChange({ ...binding, color })}
                value={binding.color ?? '#35c8ff'}
              />
              <FlowColorInput
                description={LABELS.arrowColorDesc}
                label={LABELS.arrowColor}
                onChange={(arrowColor) => onChange({ ...binding, arrowColor })}
                value={binding.arrowColor ?? binding.color ?? '#7dd3fc'}
              />
            </div>
          ) : binding.type === 'color' && binding.colorMode === 'gradient' ? (
            <div className="grid grid-cols-2 gap-2">
              <ColorInput
                label={LABELS.startColor}
                onChange={(color) => onChange({ ...binding, color })}
                value={binding.color ?? '#35c8ff'}
              />
              <ColorInput
                label={LABELS.endColor}
                onChange={(endColor) => onChange({ ...binding, endColor })}
                value={binding.endColor ?? '#ff3b30'}
              />
            </div>
          ) : (
            <ColorInput
              label={binding.type === 'color' ? LABELS.targetColor : LABELS.color}
              onChange={(color) => onChange({ ...binding, color })}
              value={binding.color ?? '#35c8ff'}
            />
          )}
          {binding.type === 'blink' ? (
            <div className="text-muted-foreground text-[10px]">
              条件满足时闪烁；条件不满足时保持原始可见状态。
            </div>
          ) : null}
        </BindingSection>
      ) : null}

      {binding.type === 'conveyorFlow' && !isConveyorNode ? (
        <div
          className="rounded-md border border-amber-400/20 bg-amber-400/10 px-2 py-1 text-[10px] text-amber-200"
          data-testid="dynamic-conveyor-unavailable"
        >
          {LABELS.conveyorUnavailable}
        </div>
      ) : null}

      {showConveyorSettings ? (
        <BindingSection testId="dynamic-conveyor-settings" title={LABELS.conveyorParams}>
          <SelectField
            label={LABELS.flowDirection}
            onChange={(direction) => onChange({ ...binding, direction })}
            options={AXIS_OPTIONS}
            value={
              binding.direction === 'x' || binding.direction === 'y' || binding.direction === 'z'
                ? binding.direction
                : 'x'
            }
          />
          {cargoTemplateSelectOptions.length > 0 ? (
            <SelectField
              getLabel={(nodeId) => (nodeId ? (cargoTemplateLabels[nodeId] ?? nodeId) : LABELS.defaultCargo)}
              label={LABELS.itemTemplate}
              onChange={(itemTemplateNodeId) =>
                onChange({ ...binding, itemTemplateNodeId: itemTemplateNodeId || undefined })
              }
              options={['', ...cargoTemplateSelectOptions]}
              value={selectedCargoTemplate}
            />
          ) : (
            <TextField
              label={LABELS.itemTemplate}
              onChange={(itemTemplateNodeId) =>
                onChange({ ...binding, itemTemplateNodeId: itemTemplateNodeId || undefined })
              }
              placeholder={LABELS.itemTemplatePlaceholder}
              value={selectedCargoTemplate}
            />
          )}
          <SelectField
            getLabel={(behavior) => CONVEYOR_ENDPOINT_BEHAVIOR_LABELS[behavior]}
            label={LABELS.conveyorEndpointBehavior}
            onChange={(endpointBehavior) => onChange({ ...binding, endpointBehavior })}
            options={CONVEYOR_ENDPOINT_BEHAVIOR_OPTIONS}
            value={binding.endpointBehavior ?? (binding.loop === false ? 'disappear' : 'loop')}
          />
          <div className="grid grid-cols-2 gap-2">
            <NumberField
              label={LABELS.conveyorDistance}
              onChange={(distance) => onChange({ ...binding, distance })}
              value={binding.distance ?? 6}
            />
            <NumberField
              label={LABELS.itemSpacing}
              onChange={(spacing) => onChange({ ...binding, spacing })}
              value={binding.spacing ?? 1.2}
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <NumberField
              label={LABELS.conveyorCadence}
              onChange={(cadenceSeconds) => onChange({ ...binding, cadenceSeconds })}
              step={0.1}
              value={binding.cadenceSeconds ?? 1.5}
            />
            <NumberField
              label={LABELS.conveyorMaxItems}
              onChange={(maxItems) => onChange({ ...binding, maxItems })}
              step={1}
              value={binding.maxItems ?? 6}
            />
          </div>
        </BindingSection>
      ) : null}

      <BindingSection showTitle={false} testId="dynamic-section-validation" title="校验提示">
        <ValidationIssues issues={validationIssues} />
      </BindingSection>
    </div>
  )
}

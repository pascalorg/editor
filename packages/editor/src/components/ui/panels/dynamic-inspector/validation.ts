'use client'

import type { DynamicAxis, DynamicBinding } from '@pascal-app/core'
import type { PathOption } from './fields'

export type DynamicBindingValidationIssue = {
  severity: 'error' | 'warning' | 'info'
  message: string
}

const AXES = new Set<DynamicAxis>(['x', 'y', 'z'])
const CONVEYOR_ENDPOINT_BEHAVIORS = new Set(['loop', 'disappear', 'continue', 'accumulate'])
const AXIS_REQUIRED_TYPES = new Set<DynamicBinding['type']>([
  'move',
  'rotate',
  'speed',
  'openClose',
])
const INPUT_RANGE_TYPES = new Set<DynamicBinding['type']>([
  'move',
  'scale',
  'level',
  'rotate',
  'speed',
  'flow',
  'brightness',
  'conveyorFlow',
  'color',
])


const CONDITIONAL_TYPES = new Set<DynamicBinding['type']>(['visible', 'blink', 'color', 'scale'])

const zh = (...codes: number[]) => String.fromCodePoint(...codes)

const CONDITION_LABELS: Partial<Record<DynamicBinding['type'], string>> = {
  visible: '可见条件',
  blink: '闪烁条件',
  color: '变色条件',
  scale: '缩放条件',
}

function validateCondition(
  issues: DynamicBindingValidationIssue[],
  binding: DynamicBinding,
) {
  if (!CONDITIONAL_TYPES.has(binding.type)) return
  if (binding.type === 'color' && binding.colorMode === 'gradient') return
  const label = CONDITION_LABELS[binding.type] ?? '条件'
  if (binding.condition === 'greaterThan' || binding.condition === 'lessThan') {
    if (typeof binding.value !== 'number' || !Number.isFinite(binding.value)) {
      issues.push({ severity: 'error', message: `${label}“高于/低于阈值”必须填写有效数字阈值。` })
    }
  } else if (binding.condition === 'equals') {
    if (binding.value == null || binding.value === '') {
      issues.push({ severity: 'error', message: `${label}“等于指定值”必须填写目标值。` })
    }
  }
}

function hasValidAxis(axis: unknown): axis is DynamicAxis {
  return typeof axis === 'string' && AXES.has(axis as DynamicAxis)
}

function hasFinitePair(value: unknown): value is [number, number] {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    typeof value[0] === 'number' &&
    typeof value[1] === 'number' &&
    Number.isFinite(value[0]) &&
    Number.isFinite(value[1])
  )
}

function validateRange(
  issues: DynamicBindingValidationIssue[],
  range: unknown,
  label: string,
  { disallowEqual }: { disallowEqual: boolean },
) {
  if (range == null) return
  if (!hasFinitePair(range)) {
    issues.push({ severity: 'error', message: `${label}必须是两个有效数字。` })
    return
  }
  if (range[0] > range[1]) {
    issues.push({ severity: 'error', message: `${label}最小值不能大于最大值。` })
    return
  }
  if (disallowEqual && range[0] === range[1]) {
    issues.push({ severity: 'error', message: `${label}最小值不能等于最大值。` })
  }
}

export function validateDynamicBinding({
  binding,
  isConveyorNode,
  pathOptions,
}: {
  binding: DynamicBinding
  isConveyorNode: boolean
  pathOptions: PathOption[]
}): DynamicBindingValidationIssue[] {
  const issues: DynamicBindingValidationIssue[] = []
  const pathExists = pathOptions.some((option) => option.path === binding.path)

  if (!binding.path) {
    issues.push({ severity: 'error', message: '必须选择一个数据路径。' })
  } else if (!pathExists) {
    issues.push({ severity: 'error', message: `数据路径不存在：${binding.path}` })
  }

  if (AXIS_REQUIRED_TYPES.has(binding.type) && !hasValidAxis(binding.axis)) {
    issues.push({ severity: 'error', message: `${binding.type} 动态缺少轴向。` })
  }

  validateCondition(issues, binding)


  if (INPUT_RANGE_TYPES.has(binding.type)) {
    validateRange(issues, binding.inputRange, '输入范围', { disallowEqual: true })
  }
  validateRange(issues, binding.outputRange, '输出范围', { disallowEqual: false })
  validateRange(issues, binding.speedRange, '速度范围', { disallowEqual: false })

  if (binding.type === 'conveyorFlow') {
    if (!isConveyorNode) {
      issues.push({
        severity: 'warning',
        message: '输送动态只建议用于输送带，普通设备预览不会执行该动态。',
      })
    }
    if (typeof binding.distance !== 'number' || !Number.isFinite(binding.distance) || binding.distance <= 0) {
      issues.push({ severity: 'error', message: '输送距离必须大于 0。' })
    }
    if (typeof binding.spacing !== 'number' || !Number.isFinite(binding.spacing) || binding.spacing <= 0) {
      issues.push({ severity: 'error', message: '货物间距必须大于 0。' })
    }
    if (
      binding.cadenceSeconds != null &&
      (typeof binding.cadenceSeconds !== 'number' ||
        !Number.isFinite(binding.cadenceSeconds) ||
        binding.cadenceSeconds <= 0)
    ) {
      issues.push({
        severity: 'error',
        message: zh(0x4e0a, 0x6599, 0x8282, 0x62cd, 0x5fc5, 0x987b, 0x5927, 0x4e8e, 0x20, 0x30, 0x3002),
      })
    }
    if (
      binding.maxItems != null &&
      (typeof binding.maxItems !== 'number' ||
        !Number.isFinite(binding.maxItems) ||
        binding.maxItems < 1 ||
        binding.maxItems > 50)
    ) {
      issues.push({
        severity: 'error',
        message: zh(
          0x6700,
          0x591a,
          0x8d27,
          0x7269,
          0x5fc5,
          0x987b,
          0x5728,
          0x20,
          0x31,
          0x20,
          0x5230,
          0x20,
          0x35,
          0x30,
          0x20,
          0x4e4b,
          0x95f4,
          0x3002,
        ),
      })
    }
    if (binding.endpointBehavior != null && !CONVEYOR_ENDPOINT_BEHAVIORS.has(binding.endpointBehavior)) {
      issues.push({
        severity: 'error',
        message: zh(0x7ec8, 0x70b9, 0x884c, 0x4e3a, 0x4e0d, 0x5408, 0x6cd5, 0x3002),
      })
    }
    if (
      typeof binding.distance === 'number' &&
      Number.isFinite(binding.distance) &&
      binding.distance > 0 &&
      typeof binding.spacing === 'number' &&
      Number.isFinite(binding.spacing) &&
      binding.spacing > binding.distance
    ) {
      issues.push({ severity: 'warning', message: '货物间距大于输送距离，预览时只会看到很少货物。' })
    }
  }

  return issues
}

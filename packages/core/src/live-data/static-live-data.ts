export type StaticLiveDataKey =
  | 'machine.status'
  | 'machine.temperature'
  | 'fan.speed'
  | 'door.open'
  | 'device.id'
  | 'alarm.count'

export type StaticLiveDataValue = string | number | boolean

export type StaticLiveDataEntry = {
  key: StaticLiveDataKey
  label: string
  value: StaticLiveDataValue
  unit?: string
}

export const STATIC_LIVE_DATA: Record<StaticLiveDataKey, StaticLiveDataEntry> = {
  'machine.status': { key: 'machine.status', label: '设备状态', value: 1 },
  'machine.temperature': {
    key: 'machine.temperature',
    label: '设备温度',
    value: 28,
    unit: '°C',
  },
  'fan.speed': { key: 'fan.speed', label: '风扇转速', value: 75, unit: '%' },
  'door.open': { key: 'door.open', label: '门开启', value: 1 },
  'device.id': { key: 'device.id', label: '设备 ID', value: 'A-001' },
  'alarm.count': { key: 'alarm.count', label: '报警数量', value: 2 },
}

export const STATIC_LIVE_DATA_OPTIONS = Object.values(STATIC_LIVE_DATA).map((entry) => ({
  label: entry.label,
  value: entry.key,
}))

export function getStaticLiveDataValue(
  key: string | null | undefined,
): StaticLiveDataValue | undefined {
  if (!key) return undefined
  return STATIC_LIVE_DATA[key as StaticLiveDataKey]?.value
}

export function formatStaticLiveDataValue(key: string | null | undefined): string {
  if (!key) return '?'
  const entry = STATIC_LIVE_DATA[key as StaticLiveDataKey]
  if (!entry) return '?'
  return `${entry.value}${entry.unit ? ` ${entry.unit}` : ''}`
}

export function renderLiveDataTemplate(
  template: string | undefined,
  key: string | undefined,
): string {
  const entry = key ? STATIC_LIVE_DATA[key as StaticLiveDataKey] : undefined
  if (!entry) return template?.replace('{value}', '?') ?? '?'
  const value = `${entry.value}`
  const unit = entry.unit ?? ''
  return (template || '{label}: {value}{unit}')
    .replaceAll('{label}', entry.label)
    .replaceAll('{key}', entry.key)
    .replaceAll('{value}', value)
    .replaceAll('{unit}', unit ? ` ${unit}` : '')
}

export type LiveDataBindingEffect = 'color' | 'rotation-y' | 'position-y'

export type LiveDataBindingConfig = {
  enabled?: boolean
  dataKey: StaticLiveDataKey
  effect: LiveDataBindingEffect
}

export function isLiveDataBindingConfig(value: unknown): value is LiveDataBindingConfig {
  if (!(value && typeof value === 'object')) return false
  const record = value as Record<string, unknown>
  return typeof record.dataKey === 'string' && typeof record.effect === 'string'
}

export function resolveBindingPreview(binding: LiveDataBindingConfig | null | undefined): string {
  if (!binding?.enabled) return '未启用'
  const value = formatStaticLiveDataValue(binding.dataKey)
  if (binding.effect === 'color') return `${value} ? 颜色`
  if (binding.effect === 'rotation-y') return `${value} ? Y 轴旋转`
  return `${value} ? 高度偏移`
}

export function resolveBindingColor(value: StaticLiveDataValue | undefined): string | null {
  if (value === 0) return '#8a8a8a'
  if (value === 1) return '#22c55e'
  if (value === 2) return '#ef4444'
  if (typeof value === 'number' && value > 0) return '#22c55e'
  return null
}

export function resolveBindingRotationYOffset(value: StaticLiveDataValue | undefined): number {
  const numeric = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(numeric)) return 0
  return (Math.max(0, Math.min(100, numeric)) / 100) * Math.PI * 2
}

export function resolveBindingPositionYOffset(value: StaticLiveDataValue | undefined): number {
  if (value === true) return 1
  if (value === false) return 0
  const numeric = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(numeric)) return 0
  return numeric > 0 ? 1 : 0
}

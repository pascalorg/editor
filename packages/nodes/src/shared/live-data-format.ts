import type { LiveDataPath, LiveDataValue } from '@pascal-app/core'

export function findLiveDataPath(paths: readonly LiveDataPath[], path: string | null | undefined) {
  if (!path) return undefined
  return paths.find((entry) => entry.path === path)
}

export function formatLiveDataPathValue(
  paths: readonly LiveDataPath[],
  values: Record<string, LiveDataValue>,
  path: string | null | undefined,
) {
  if (!path) return '?'
  const value = values[path]
  if (value == null) return '?'
  const unit = findLiveDataPath(paths, path)?.unit
  return `${value}${unit ? ` ${unit}` : ''}`
}

export function formatLiveDataPathOption(
  paths: readonly LiveDataPath[],
  values: Record<string, LiveDataValue>,
  path: string,
) {
  const entry = findLiveDataPath(paths, path)
  const label = entry?.label ?? path
  return `${label} (${formatLiveDataPathValue(paths, values, path)})`
}

export function liveDataPathLabel(paths: readonly LiveDataPath[], path: string) {
  return findLiveDataPath(paths, path)?.label ?? path
}

export function numericLiveDataPathValue(values: Record<string, LiveDataValue>, path: string) {
  const value = values[path]
  const numeric = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(numeric) ? numeric : 0
}

export function renderLiveDataPathTemplate({
  path,
  paths,
  template,
  values,
}: {
  path: string | undefined
  paths: readonly LiveDataPath[]
  template: string | undefined
  values: Record<string, LiveDataValue>
}) {
  if (!path) return template?.replace('{value}', '?') ?? '?'
  const entry = findLiveDataPath(paths, path)
  const value = values[path]
  const valueText = value == null ? '?' : String(value)
  const unit = entry?.unit ?? ''
  return (template || '{label}: {value}{unit}')
    .replaceAll('{label}', entry?.label ?? path)
    .replaceAll('{key}', path)
    .replaceAll('{path}', path)
    .replaceAll('{value}', valueText)
    .replaceAll('{unit}', unit ? ` ${unit}` : '')
}

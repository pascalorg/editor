'use client'

import {
  type AnyNode,
  type AnyNodeId,
  formatStaticLiveDataValue,
  getLiveDataPathLabel,
  getStaticLiveDataValue,
  isDynamicBinding,
  isLiveDataBindingConfig,
  useScene,
} from '@pascal-app/core'
import useViewer from '@pascal-app/viewer/store'
import { Html } from '@react-three/drei'
import { Database, Radio, RadioTower } from 'lucide-react'
import { memo, useMemo } from 'react'
import {
  type ObjectCapabilityProfile,
  resolveObjectCapabilities,
} from '../../../lib/object-capabilities'
import { cn } from '../../../lib/utils'
import useEditor from '../../../store/use-editor'

type DataLensStatus = 'bound' | 'ready'

type DataLensItem = {
  nodeId: string
  label: string
  status: DataLensStatus
  position: [number, number, number]
  sourceLabel: string
  bindingLabels: string[]
  valueLabels: string[]
}

type AnyRecord = Record<string, unknown>

function isRecord(value: unknown): value is AnyRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function vector3(value: unknown): [number, number, number] | undefined {
  if (
    Array.isArray(value) &&
    value.length >= 3 &&
    typeof value[0] === 'number' &&
    typeof value[1] === 'number' &&
    typeof value[2] === 'number'
  ) {
    return [value[0], value[1], value[2]]
  }
  return undefined
}

function numberValue(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function stringValue(value: unknown) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined
}

function metadataOf(node: AnyNode | undefined) {
  const metadata = (node as unknown as { metadata?: unknown })?.metadata
  return isRecord(metadata) ? metadata : {}
}

function nodeBasePosition(node: AnyNode | undefined): [number, number, number] {
  if (!node) return [0, 0, 0]
  return vector3((node as unknown as AnyRecord).position) ?? [0, 0, 0]
}

function estimateLabelHeight(node: AnyNode | undefined, profile: ObjectCapabilityProfile) {
  if (!node) return 2.6
  const record = node as unknown as AnyRecord
  if (profile.equipmentFamily === 'column') return 8.8
  if (profile.equipmentFamily === 'tank') return 4.4
  if (profile.equipmentFamily === 'pump') return 2.2
  return (numberValue(record.height) ?? 2.4) + 1
}

function isEquipmentProfile(profile: ObjectCapabilityProfile) {
  return (
    profile.sources.includes('semantic-assembly') ||
    profile.sources.includes('factory-equipment') ||
    Boolean(profile.recipeId || profile.equipmentFamily)
  )
}

function dynamicBindingsFrom(metadata: AnyRecord) {
  return Array.isArray(metadata.dynamicBindings)
    ? metadata.dynamicBindings.filter(isDynamicBinding)
    : []
}

function legacyBindingFrom(metadata: AnyRecord) {
  const binding = metadata.liveDataBinding
  return isLiveDataBindingConfig(binding) && binding.enabled !== false ? binding : undefined
}

function hasLooseBindingMetadata(metadata: AnyRecord) {
  return Boolean(
    metadata.liveDataBindings ||
      metadata.dataBinding ||
      metadata.dataBindings ||
      metadata.telemetry,
  )
}

function compactBindingLabel(label: string) {
  return label.length > 40 ? `${label.slice(0, 37)}...` : label
}

function dataLensItems(nodes: Record<string, AnyNode | undefined>) {
  const items: DataLensItem[] = []
  for (const node of Object.values(nodes)) {
    const profile = resolveObjectCapabilities(node, nodes)
    if (!profile || !isEquipmentProfile(profile)) continue

    const metadata = metadataOf(node)
    const base = nodeBasePosition(node)
    const dynamicBindings = dynamicBindingsFrom(metadata)
    const legacyBinding = legacyBindingFrom(metadata)
    const looseBinding = hasLooseBindingMetadata(metadata)
    const bound = Boolean(legacyBinding || dynamicBindings.length || looseBinding)
    const bindingLabels = [
      legacyBinding ? `${legacyBinding.effect}: ${legacyBinding.dataKey}` : undefined,
      ...dynamicBindings.map((binding) => `${binding.type}: ${binding.path}`),
      looseBinding && !legacyBinding && dynamicBindings.length === 0
        ? 'external telemetry'
        : undefined,
    ]
      .filter((value): value is string => Boolean(value))
      .map(compactBindingLabel)
      .slice(0, 4)
    const valueLabels = [
      legacyBinding
        ? `${formatStaticLiveDataValue(legacyBinding.dataKey)} ${
            getStaticLiveDataValue(legacyBinding.dataKey) == null ? 'offline' : 'sample'
          }`
        : undefined,
      ...dynamicBindings
        .map((binding) => getLiveDataPathLabel(binding.path) || stringValue(binding.path))
        .filter((value): value is string => Boolean(value))
        .slice(0, 2),
    ].filter((value): value is string => Boolean(value))

    items.push({
      nodeId: profile.nodeId,
      label: profile.label ?? String(node?.id ?? 'Equipment'),
      status: bound ? 'bound' : 'ready',
      position: [base[0], base[1] + estimateLabelHeight(node, profile), base[2]],
      sourceLabel: bound
        ? `${bindingLabels.length} binding${bindingLabels.length === 1 ? '' : 's'}`
        : 'Ready to bind',
      bindingLabels,
      valueLabels,
    })
  }

  return items.slice(0, 64)
}

export const DataLensOverlay = memo(function DataLensOverlay() {
  const canvasLens = useEditor((state) => state.canvasLens)
  const nodes = useScene((state) => state.nodes)
  const selectedIds = useViewer((state) => state.selection.selectedIds)
  const setSelection = useViewer((state) => state.setSelection)
  const items = useMemo(
    () => (canvasLens === 'data' ? dataLensItems(nodes) : []),
    [canvasLens, nodes],
  )
  const selectedIdSet = useMemo(() => new Set(selectedIds.map(String)), [selectedIds])

  if (canvasLens !== 'data' || items.length === 0) return null

  return (
    <group name="data-lens-overlay">
      {items.map((item) => {
        const selected = selectedIdSet.has(item.nodeId)
        const bound = item.status === 'bound'
        const Icon = bound ? RadioTower : Database
        return (
          <Html
            center
            distanceFactor={18}
            key={item.nodeId}
            position={item.position}
            zIndexRange={[36, 0]}
          >
            <button
              className={cn(
                'pointer-events-auto min-w-40 max-w-60 rounded-lg border px-2.5 py-2 text-left text-white shadow-xl backdrop-blur-md transition-colors',
                bound
                  ? selected
                    ? 'border-sky-200/90 bg-sky-500/25'
                    : 'border-sky-200/30 bg-zinc-950/80 hover:border-sky-200/70 hover:bg-zinc-900/90'
                  : selected
                    ? 'border-amber-200/90 bg-amber-500/25'
                    : 'border-amber-200/30 bg-zinc-950/80 hover:border-amber-200/70 hover:bg-zinc-900/90',
              )}
              data-data-lens-node-id={item.nodeId}
              data-testid={`data-lens-card-${item.nodeId}`}
              onClick={() => setSelection({ selectedIds: [item.nodeId as AnyNodeId] })}
              type="button"
            >
              <span className="flex min-w-0 items-center gap-1.5">
                <Icon
                  className={cn('h-3.5 w-3.5 shrink-0', bound ? 'text-sky-200' : 'text-amber-200')}
                />
                <span className="truncate font-medium text-[12px]">{item.label}</span>
              </span>
              <span
                className={cn(
                  'mt-0.5 flex items-center gap-1 truncate text-[10px]',
                  bound ? 'text-sky-100/75' : 'text-amber-100/75',
                )}
                data-testid={`data-lens-status-${item.nodeId}`}
              >
                <Radio className="h-2.5 w-2.5 shrink-0" />
                {item.sourceLabel}
              </span>
              {item.bindingLabels.length > 0 ? (
                <span className="mt-1.5 flex flex-wrap gap-1">
                  {item.bindingLabels.map((label) => (
                    <span
                      className="rounded border border-sky-200/20 bg-sky-200/10 px-1.5 py-0.5 text-[9px] text-sky-50"
                      data-testid={`data-lens-binding-${item.nodeId}`}
                      key={label}
                    >
                      {label}
                    </span>
                  ))}
                </span>
              ) : (
                <span className="mt-1.5 inline-flex rounded border border-amber-200/20 bg-amber-200/10 px-1.5 py-0.5 text-[9px] text-amber-50">
                  no live mapping
                </span>
              )}
              {item.valueLabels.length > 0 && (
                <span className="mt-1.5 flex flex-wrap gap-1">
                  {item.valueLabels.map((label) => (
                    <span
                      className="rounded border border-white/15 bg-white/10 px-1.5 py-0.5 text-[9px] text-white"
                      data-testid={`data-lens-value-${item.nodeId}`}
                      key={label}
                    >
                      {label}
                    </span>
                  ))}
                </span>
              )}
            </button>
          </Html>
        )
      })}
    </group>
  )
})

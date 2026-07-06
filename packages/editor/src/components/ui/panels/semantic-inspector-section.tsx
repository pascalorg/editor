'use client'

import {
  type AnyNode,
  type AnyNodeId,
  formatLiveDataValue,
  getMaterialPresetByRef,
  isDynamicBinding,
  isLiveDataBindingConfig,
  type LiveDataPath,
  type LiveDataValue,
  type MaterialSchema,
  useScene,
  useLiveData,
} from '@pascal-app/core'
import useViewer from '@pascal-app/viewer/store'
import { Database, Plug, Tag, Wrench } from 'lucide-react'
import { useMemo, useState } from 'react'
import {
  type ObjectCapabilityProfile,
  type ObjectPartSummary,
  type ObjectPortSummary,
  resolveObjectCapabilities,
} from '../../../lib/object-capabilities'
import {
  buildSemanticLiveDataBinding,
  defaultSemanticLiveDataPath,
  semanticLiveDataBindingTargets,
  type SemanticLiveDataBindingTarget,
  upsertSemanticLiveDataBinding,
} from '../../../lib/semantic-live-data-bindings'
import {
  DEFAULT_CUSTOM_MATERIAL_PROPERTIES,
  withMaterialProperties,
} from '../../../lib/material-appearance'
import { cn } from '../../../lib/utils'
import { MaterialSwatchField } from '../controls/material-swatch-field'
import { PanelSection } from '../controls/panel-section'
import { SliderControl } from '../controls/slider-control'
import { SemanticEquipmentParamControls } from './semantic-equipment-params'

type AnyRecord = Record<string, unknown>

function isRecord(value: unknown): value is AnyRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function metadataOf(node: unknown) {
  const metadata = isRecord(node) ? node.metadata : undefined
  return isRecord(metadata) ? metadata : {}
}

function stringValue(value: unknown) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined
}

function sourcePackLabel(metadata: AnyRecord) {
  const sourcePack = isRecord(metadata.sourcePack) ? metadata.sourcePack : undefined
  const id = stringValue(sourcePack?.id)
  const version = stringValue(sourcePack?.version)
  if (!id) return undefined
  return version ? `${id}@${version}` : id
}

function dynamicBindingLabels(metadata: AnyRecord) {
  return Array.isArray(metadata.dynamicBindings)
    ? metadata.dynamicBindings
        .filter(isDynamicBinding)
        .map((binding) => `${binding.type}: ${binding.path}`)
    : []
}

function liveDataBindingLabels(metadata: AnyRecord) {
  const binding = metadata.liveDataBinding
  if (isLiveDataBindingConfig(binding) && binding.enabled !== false) {
    return [`${binding.effect}: ${binding.dataKey}`]
  }
  const labels: string[] = []
  if (metadata.liveDataBindings) labels.push('liveDataBindings')
  if (metadata.dataBinding) labels.push('dataBinding')
  if (metadata.dataBindings) labels.push('dataBindings')
  if (metadata.telemetry) labels.push('telemetry')
  return labels
}

function liveDataBindingFields(metadata: AnyRecord) {
  const fields: { label: string; path: string }[] = []
  const binding = metadata.liveDataBinding
  if (isLiveDataBindingConfig(binding) && binding.enabled !== false) {
    fields.push({ label: binding.effect, path: binding.dataKey })
  }
  if (Array.isArray(metadata.dynamicBindings)) {
    for (const binding of metadata.dynamicBindings.filter(isDynamicBinding)) {
      fields.push({ label: binding.type, path: binding.path })
    }
  }
  return fields
}

function liveDataPathMeta(paths: LiveDataPath[], path: string) {
  return paths.find((entry) => entry.path === path)
}

function liveDataValueText(
  values: Record<string, LiveDataValue>,
  paths: LiveDataPath[],
  path: string,
) {
  return formatLiveDataValue(values[path], liveDataPathMeta(paths, path)?.unit)
}

function existingDynamicBindingPath(
  metadata: AnyRecord,
  profile: ObjectCapabilityProfile,
  target: SemanticLiveDataBindingTarget,
) {
  const id = buildSemanticLiveDataBinding({ profile, target, path: '' }).id
  const bindings = Array.isArray(metadata.dynamicBindings)
    ? metadata.dynamicBindings.filter(isDynamicBinding)
    : []
  return bindings.find((binding) => binding.id === id)?.path
}

function SemanticChip({
  children,
  tone = 'neutral',
}: {
  children: React.ReactNode
  tone?: 'neutral' | 'green' | 'amber' | 'sky'
}) {
  return (
    <span
      className={cn(
        'inline-flex min-w-0 items-center rounded border px-1.5 py-0.5 text-[10px]',
        tone === 'green' && 'border-emerald-300/20 bg-emerald-300/10 text-emerald-100',
        tone === 'amber' && 'border-amber-300/20 bg-amber-300/10 text-amber-100',
        tone === 'sky' && 'border-sky-300/20 bg-sky-300/10 text-sky-100',
        tone === 'neutral' && 'border-border/70 bg-background/60 text-muted-foreground',
      )}
    >
      {children}
    </span>
  )
}

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  if (value == null || value === '') return null
  return (
    <div className="grid grid-cols-[76px_minmax(0,1fr)] gap-2 rounded border border-border/40 bg-muted/15 px-2 py-1.5 text-[11px]">
      <div className="text-muted-foreground">{label}</div>
      <div className="min-w-0 truncate text-foreground">{value}</div>
    </div>
  )
}

function EquipmentTab({
  metadata,
  profile,
}: {
  metadata: AnyRecord
  profile: ObjectCapabilityProfile
}) {
  return (
    <div className="space-y-2" data-testid="semantic-inspector-equipment">
      <InfoRow label="Node" value={`${profile.nodeType} / ${profile.nodeId}`} />
      <InfoRow label="Family" value={profile.equipmentFamily} />
      <InfoRow label="Recipe" value={profile.recipeId} />
      <InfoRow label="Profile" value={profile.profileId} />
      <InfoRow label="Station" value={stringValue(metadata.stationId)} />
      <div className="grid gap-1.5 rounded border border-border/45 bg-background/35 p-2 text-[11px]">
        <div className="flex items-center gap-1.5 text-foreground">
          <Tag className="h-3.5 w-3.5 text-emerald-200" />
          当前设置只影响这个设备实例。
        </div>
        <div className="text-muted-foreground">
          行业包模板保持只读；需要改模板时请在行业包工具中处理。
        </div>
      </div>
      <SemanticEquipmentParamControls nodeId={profile.nodeId as AnyNodeId} />
    </div>
  )
}

function partLabel(part: ObjectPartSummary) {
  return part.semanticRole ?? part.sourcePartKind ?? part.nodeId ?? 'part'
}

function materialSide(value: unknown): 'front' | 'back' | 'double' {
  return value === 'back' || value === 'double' ? value : 'front'
}

function readPartMaterial(node: AnyNode | undefined) {
  const material = (node as { material?: MaterialSchema } | undefined)?.material
  const materialPreset = (node as { materialPreset?: string } | undefined)?.materialPreset
  const presetProperties = getMaterialPresetByRef(materialPreset)?.mapProperties
  const mergedProperties = {
    ...DEFAULT_CUSTOM_MATERIAL_PROPERTIES,
    ...presetProperties,
    ...material?.properties,
  }
  return {
    material,
    materialPreset: material ? undefined : materialPreset,
    properties: {
      color: mergedProperties.color,
      roughness: mergedProperties.roughness,
      metalness: mergedProperties.metalness,
      opacity: mergedProperties.opacity,
      transparent: mergedProperties.transparent,
      side: materialSide(mergedProperties.side),
    },
  }
}

function PartMaterialControls({ part }: { part: ObjectPartSummary }) {
  const nodeId = part.nodeId as AnyNodeId | undefined
  const node = useScene((state) => (nodeId ? state.nodes[nodeId] : undefined))
  const updateNode = useScene((state) => state.updateNode)
  if (!(node && nodeId && part.editable)) return null

  const values = readPartMaterial(node)
  const label = partLabel(part)

  const writeMaterial = (material: MaterialSchema | undefined, materialPreset?: string) => {
    updateNode(nodeId, {
      material,
      materialPreset,
    } as Partial<AnyNode>)
    useScene.getState().markDirty(nodeId)
  }

  return (
    <div
      className="grid gap-1.5 rounded border border-border/35 bg-muted/10 p-2"
      data-testid={`semantic-inspector-part-${label}-controls`}
    >
      <MaterialSwatchField
        label="Part material"
        selectedMaterialPreset={values.materialPreset}
        value={values.material}
        onChange={(material) => {
          const nextProperties = {
            ...values.properties,
            ...material.properties,
          }
          writeMaterial({
            ...material,
            preset: 'custom',
            properties: {
              color: nextProperties.color,
              roughness: nextProperties.roughness,
              metalness: nextProperties.metalness,
              opacity: nextProperties.opacity,
              side: materialSide(nextProperties.side),
              transparent:
                (material.properties?.opacity ?? values.properties.opacity) < 1 ||
                material.properties?.transparent === true ||
                material.gradient?.stops.some((stop) => stop.opacity < 1) === true,
            },
          })
        }}
        onSelectMaterialPreset={(materialPreset) => writeMaterial(undefined, materialPreset)}
      />
      <div data-testid={`semantic-inspector-part-${label}-opacity`}>
        <SliderControl
          label="Opacity"
          max={1}
          min={0.05}
          onChange={(opacity) =>
            writeMaterial(
              withMaterialProperties(
                { preset: 'custom', properties: values.properties },
                { opacity },
              ),
            )
          }
          precision={2}
          step={0.01}
          value={values.properties.opacity}
        />
      </div>
    </div>
  )
}

function PartsTab({ parts }: { parts: ObjectPartSummary[] }) {
  const setSelection = useViewer((state) => state.setSelection)
  if (parts.length === 0) {
    return (
      <div className="rounded border border-border/45 bg-muted/15 px-2 py-2 text-[11px] text-muted-foreground">
        No semantic parts exposed.
      </div>
    )
  }
  return (
    <div className="grid gap-1.5" data-testid="semantic-inspector-parts">
      {parts.map((part, index) => {
        const label = partLabel(part)
        return (
          <div
            className="grid gap-1.5 rounded border border-border/45 bg-background/40 p-1.5"
            key={`${part.nodeId ?? 'part'}-${label}-${index}`}
          >
            <button
              className="flex items-center justify-between gap-2 rounded px-1 py-1 text-left text-[11px] transition-colors hover:bg-emerald-300/10"
              data-testid={`semantic-inspector-part-${label}`}
              disabled={!part.nodeId}
              onClick={() => {
                if (part.nodeId) setSelection({ selectedIds: [part.nodeId as AnyNodeId] })
              }}
              type="button"
            >
              <span className="min-w-0 truncate text-foreground">{label}</span>
              <span className={part.editable ? 'text-emerald-300' : 'text-muted-foreground'}>
                {part.editable ? 'editable' : 'locked'}
              </span>
            </button>
            <PartMaterialControls part={part} />
          </div>
        )
      })}
    </div>
  )
}

function PortsTab({ ports }: { ports: ObjectPortSummary[] }) {
  if (ports.length === 0) {
    return (
      <div className="rounded border border-border/45 bg-muted/15 px-2 py-2 text-[11px] text-muted-foreground">
        No ports exposed.
      </div>
    )
  }
  return (
    <div className="grid gap-1.5" data-testid="semantic-inspector-ports">
      {ports.map((port) => (
        <div
          className="grid gap-1.5 rounded border border-border/45 bg-background/40 px-2 py-1.5 text-[11px]"
          data-testid={`semantic-inspector-port-${port.id}`}
          key={port.id}
        >
          <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
            <div className="min-w-0 truncate text-foreground">{port.id}</div>
            <div className="flex gap-1">
              {port.medium && <SemanticChip tone="sky">{port.medium}</SemanticChip>}
              {port.side && <SemanticChip tone="amber">{port.side}</SemanticChip>}
              {port.dataKey && <SemanticChip tone="green">data</SemanticChip>}
            </div>
          </div>
          {port.connections.length > 0 ? (
            <div className="grid gap-1" data-testid={`semantic-inspector-port-${port.id}-connections`}>
              {port.connections.map((connection, index) => {
                const target =
                  connection.connectedNodeLabel ??
                  connection.connectedStationId ??
                  connection.connectedNodeId ??
                  'Unknown target'
                return (
                  <div
                    className="grid gap-0.5 rounded bg-muted/20 px-2 py-1 text-muted-foreground"
                    data-testid={`semantic-inspector-port-${port.id}-connection-${index}`}
                    key={`${connection.nodeId}-${connection.direction}-${connection.connectedPortId ?? index}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-foreground">
                        {connection.direction === 'outgoing' ? 'To' : 'From'} {target}
                      </span>
                      {connection.connectedPortId && (
                        <SemanticChip>{connection.connectedPortId}</SemanticChip>
                      )}
                    </div>
                    <div className="truncate">
                      via {connection.nodeType} {connection.nodeId}
                      {connection.medium ? ` / ${connection.medium}` : ''}
                    </div>
                  </div>
                )
              })}
            </div>
          ) : (
            <div
              className="rounded bg-muted/15 px-2 py-1 text-muted-foreground"
              data-testid={`semantic-inspector-port-${port.id}-unconnected`}
            >
              No connection
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

function SemanticLiveDataBindingControl({
  metadata,
  profile,
  target,
}: {
  metadata: AnyRecord
  profile: ObjectCapabilityProfile
  target: SemanticLiveDataBindingTarget
}) {
  const node = useScene((state) => state.nodes[profile.nodeId as AnyNodeId])
  const updateNode = useScene((state) => state.updateNode)
  const markDirty = useScene((state) => state.markDirty)
  const paths = useLiveData((state) => state.paths)
  const values = useLiveData((state) => state.values)
  const fallbackPath = defaultSemanticLiveDataPath(target, paths)
  const currentPath = existingDynamicBindingPath(metadata, profile, target)
  const [selectedPath, setSelectedPath] = useState(currentPath ?? fallbackPath)
  const pathOptions = selectedPath && !paths.some((path) => path.path === selectedPath)
    ? [{ path: selectedPath, label: selectedPath, valueType: 'string' as const }, ...paths]
    : paths
  const selectedMeta = liveDataPathMeta(paths, selectedPath)

  return (
    <div
      className="grid gap-1.5 rounded border border-border/45 bg-background/40 p-2 text-[11px]"
      data-testid={`semantic-inspector-data-target-${target.id}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-foreground">{target.label}</div>
          <div className="truncate text-muted-foreground">{target.description}</div>
        </div>
        <SemanticChip tone={currentPath ? 'green' : 'sky'}>
          {currentPath ? 'bound' : target.type}
        </SemanticChip>
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
        <select
          className="h-7 min-w-0 rounded border border-border/50 bg-background/70 px-2 text-[11px] text-foreground"
          data-testid={`semantic-inspector-data-path-${target.id}`}
          disabled={pathOptions.length === 0}
          onChange={(event) => setSelectedPath(event.target.value)}
          value={selectedPath}
        >
          {pathOptions.map((path) => (
            <option key={path.path} value={path.path}>
              {path.label} / {formatLiveDataValue(values[path.path], path.unit)}
            </option>
          ))}
        </select>
        <button
          className="h-7 rounded border border-emerald-300/30 bg-emerald-300/10 px-2 font-medium text-[11px] text-emerald-100 transition hover:bg-emerald-300/20 disabled:cursor-not-allowed disabled:opacity-50"
          data-testid={`semantic-inspector-data-bind-${target.id}`}
          disabled={!node || !selectedPath}
          onClick={() => {
            if (!(node && selectedPath)) return
            updateNode(
              profile.nodeId as AnyNodeId,
              upsertSemanticLiveDataBinding({ node, profile, target, path: selectedPath }),
            )
            markDirty(profile.nodeId as AnyNodeId)
          }}
          type="button"
        >
          Apply
        </button>
      </div>
      <div className="truncate text-muted-foreground">
        {selectedPath} = {formatLiveDataValue(values[selectedPath], selectedMeta?.unit)}
      </div>
    </div>
  )
}

function DataTab({ metadata, profile }: { metadata: AnyRecord; profile: ObjectCapabilityProfile }) {
  const endpoint = useLiveData((state) => state.endpoint)
  const status = useLiveData((state) => state.status)
  const paths = useLiveData((state) => state.paths)
  const snapshot = useLiveData((state) => state.snapshot)
  const values = useLiveData((state) => state.values)
  const labels = [...liveDataBindingLabels(metadata), ...dynamicBindingLabels(metadata)]
  const fields = liveDataBindingFields(metadata)
  const targets = semanticLiveDataBindingTargets(profile)
  const timestamp = snapshot?.timestamp ? new Date(snapshot.timestamp).toLocaleTimeString() : null
  return (
    <div className="space-y-2" data-testid="semantic-inspector-data">
      <div className="flex flex-wrap gap-1">
        {profile.sources.includes('live-data') ? (
          <SemanticChip tone="green">bound</SemanticChip>
        ) : (
          <SemanticChip tone="amber">ready to bind</SemanticChip>
        )}
        {profile.capabilities.some((capability) => capability.id === 'data-binding') && (
          <SemanticChip tone="sky">data-binding editable</SemanticChip>
        )}
      </div>
      <div
        className="grid gap-1 rounded border border-border/45 bg-background/35 px-2 py-1.5 text-[11px]"
        data-testid="semantic-inspector-data-source"
      >
        <div className="flex min-w-0 justify-between gap-2">
          <span className="text-muted-foreground">Source</span>
          <span className="min-w-0 truncate text-foreground">{endpoint ?? 'none'}</span>
        </div>
        <div className="flex min-w-0 justify-between gap-2">
          <span className="text-muted-foreground">Status</span>
          <span className="min-w-0 truncate text-foreground">
            {status}
            {timestamp ? ` / ${timestamp}` : ''}
          </span>
        </div>
        <div className="flex min-w-0 justify-between gap-2">
          <span className="text-muted-foreground">Fields</span>
          <span className="min-w-0 truncate text-foreground">{paths.length}</span>
        </div>
      </div>
      {labels.length > 0 ? (
        <div className="grid gap-1">
          {labels.map((label) => (
            <div
              className="rounded border border-border/45 bg-background/40 px-2 py-1.5 text-[11px] text-foreground"
              data-testid="semantic-inspector-data-binding"
              key={label}
            >
              {label}
            </div>
          ))}
        </div>
      ) : (
        <div className="rounded border border-border/45 bg-muted/15 px-2 py-2 text-[11px] text-muted-foreground">
          No live data mapping on this instance.
        </div>
      )}
      {fields.length > 0 ? (
        <div className="grid gap-1">
          {fields.map((field) => (
            <div
              className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 rounded border border-sky-300/20 bg-sky-300/10 px-2 py-1.5 text-[11px]"
              data-testid="semantic-inspector-data-value"
              key={`${field.label}-${field.path}`}
            >
              <span className="min-w-0 truncate text-sky-50">
                {field.label}: {field.path}
              </span>
              <span className="shrink-0 text-sky-100">{liveDataValueText(values, paths, field.path)}</span>
            </div>
          ))}
        </div>
      ) : null}
      <div className="grid gap-1.5" data-testid="semantic-inspector-data-targets">
        {targets.map((target) => (
          <SemanticLiveDataBindingControl
            key={target.id}
            metadata={metadata}
            profile={profile}
            target={target}
          />
        ))}
      </div>
    </div>
  )
}

function SourceTab({ metadata, profile }: { metadata: AnyRecord; profile: ObjectCapabilityProfile }) {
  return (
    <div className="space-y-2" data-testid="semantic-inspector-source">
      <div className="flex flex-wrap gap-1">
        {profile.sources.map((source) => (
          <SemanticChip key={source}>{source}</SemanticChip>
        ))}
      </div>
      <InfoRow label="Pack" value={sourcePackLabel(metadata)} />
      <InfoRow label="Process" value={stringValue(metadata.processId)} />
      <InfoRow label="Role" value={stringValue(metadata.equipmentRole)} />
      <InfoRow label="Generated" value={stringValue(metadata.generatedBy)} />
    </div>
  )
}

export function SemanticInspectorSection({ nodeId }: { nodeId: AnyNodeId }) {
  const nodes = useScene((state) => state.nodes)
  const profile = useMemo(() => resolveObjectCapabilities(nodes[nodeId], nodes), [nodeId, nodes])
  const metadata = metadataOf(nodes[nodeId])

  if (!profile) return null

  return (
    <div data-testid="semantic-inspector">
      <PanelSection title="设备设置">
        <EquipmentTab metadata={metadata} profile={profile} />
      </PanelSection>
      <PanelSection title="外观与部件">
        <div className="mb-1 flex items-center gap-1.5 text-muted-foreground text-[11px]">
          <Wrench className="h-3.5 w-3.5" />
          暴露的语义部件可以单独改颜色、材质和透明度；未暴露的底层几何保留在高级属性中。
        </div>
        <PartsTab parts={profile.editableParts} />
      </PanelSection>
      <PanelSection title="数据与动态">
        <div className="mb-1 flex items-center gap-1.5 text-muted-foreground text-[11px]">
          <Database className="h-3.5 w-3.5" />
          数据字段绑定到设备能力后，会驱动液位、流动、颜色或报警等动态效果。
        </div>
        <DataTab metadata={metadata} profile={profile} />
      </PanelSection>
      <PanelSection defaultExpanded={false} title="连接与来源">
        <div className="mb-1 flex items-center gap-1.5 text-muted-foreground text-[11px]">
          <Plug className="h-3.5 w-3.5" />
          端口用于说明设备连接关系；来源用于追踪行业包、AI 或资产生成路径。
        </div>
        <PortsTab ports={profile.ports} />
        <SourceTab metadata={metadata} profile={profile} />
      </PanelSection>
    </div>
  )
}

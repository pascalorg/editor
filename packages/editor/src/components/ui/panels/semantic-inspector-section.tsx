'use client'

import { type AnyNodeId, isDynamicBinding, isLiveDataBindingConfig, useScene } from '@pascal-app/core'
import useViewer from '@pascal-app/viewer/store'
import { Box, Database, GitBranch, Plug, Tag, Wrench } from 'lucide-react'
import { useMemo, useState } from 'react'
import {
  type ObjectCapabilityProfile,
  type ObjectPartSummary,
  type ObjectPortSummary,
  resolveObjectCapabilities,
} from '../../../lib/object-capabilities'
import { cn } from '../../../lib/utils'
import { PanelSection } from '../controls/panel-section'
import { SemanticEquipmentParamControls } from './semantic-equipment-params'

type SemanticInspectorTab = 'equipment' | 'parts' | 'ports' | 'data' | 'source'
type AnyRecord = Record<string, unknown>

const TABS: readonly {
  key: SemanticInspectorTab
  label: string
  icon: typeof Box
}[] = [
  { key: 'equipment', label: 'Equipment', icon: Box },
  { key: 'parts', label: 'Parts', icon: Wrench },
  { key: 'ports', label: 'Ports', icon: Plug },
  { key: 'data', label: 'Data', icon: Database },
  { key: 'source', label: 'Source', icon: GitBranch },
]

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

function CapabilityList({ profile }: { profile: ObjectCapabilityProfile }) {
  return (
    <div className="grid gap-1">
      {profile.capabilities.map((capability) => (
        <div
          className="flex items-center justify-between gap-2 rounded border border-border/45 bg-background/40 px-2 py-1.5 text-[11px]"
          data-testid={`semantic-inspector-capability-${capability.id}`}
          key={`${capability.id}-${capability.target}`}
        >
          <span className="min-w-0 truncate text-foreground">{capability.label}</span>
          <span className={capability.editable ? 'text-emerald-300' : 'text-muted-foreground'}>
            {capability.editable ? 'editable' : 'read-only'} / {capability.target}
          </span>
        </div>
      ))}
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
          Instance edits affect this selected object only.
        </div>
        <div className="text-muted-foreground">
          Profile edits are read-only in this MVP and belong to industry pack tooling.
        </div>
      </div>
      <SemanticEquipmentParamControls nodeId={profile.nodeId as AnyNodeId} />
      <CapabilityList profile={profile} />
    </div>
  )
}

function partLabel(part: ObjectPartSummary) {
  return part.semanticRole ?? part.sourcePartKind ?? part.nodeId ?? 'part'
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
      {parts.map((part, index) => (
        <button
          className="flex items-center justify-between gap-2 rounded border border-border/45 bg-background/40 px-2 py-1.5 text-left text-[11px] transition-colors hover:border-emerald-300/50 hover:bg-emerald-300/10"
          data-testid={`semantic-inspector-part-${partLabel(part)}`}
          disabled={!part.nodeId}
          key={`${part.nodeId ?? 'part'}-${partLabel(part)}-${index}`}
          onClick={() => {
            if (part.nodeId) setSelection({ selectedIds: [part.nodeId as AnyNodeId] })
          }}
          type="button"
        >
          <span className="min-w-0 truncate text-foreground">{partLabel(part)}</span>
          <span className={part.editable ? 'text-emerald-300' : 'text-muted-foreground'}>
            {part.editable ? 'editable' : 'locked'}
          </span>
        </button>
      ))}
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

function DataTab({ metadata, profile }: { metadata: AnyRecord; profile: ObjectCapabilityProfile }) {
  const labels = [...liveDataBindingLabels(metadata), ...dynamicBindingLabels(metadata)]
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
  const [activeTab, setActiveTab] = useState<SemanticInspectorTab>('equipment')

  if (!profile) return null

  return (
    <PanelSection title="Semantic Inspector">
      <div className="space-y-2 text-xs" data-testid="semantic-inspector">
        <div className="grid grid-cols-5 gap-1">
          {TABS.map((tab) => {
            const Icon = tab.icon
            const active = activeTab === tab.key
            return (
              <button
                aria-pressed={active}
                className={cn(
                  'flex min-w-0 items-center justify-center gap-1 rounded border px-1.5 py-1 text-[10px] transition-colors',
                  active
                    ? 'border-emerald-300/50 bg-emerald-300/15 text-emerald-50'
                    : 'border-border/50 bg-background/40 text-muted-foreground hover:text-foreground',
                )}
                data-testid={`semantic-inspector-tab-${tab.key}`}
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                type="button"
              >
                <Icon className="h-3 w-3 shrink-0" />
                <span className="hidden min-w-0 truncate xl:inline">{tab.label}</span>
              </button>
            )
          })}
        </div>
        {activeTab === 'equipment' && <EquipmentTab metadata={metadata} profile={profile} />}
        {activeTab === 'parts' && <PartsTab parts={profile.editableParts} />}
        {activeTab === 'ports' && <PortsTab ports={profile.ports} />}
        {activeTab === 'data' && <DataTab metadata={metadata} profile={profile} />}
        {activeTab === 'source' && <SourceTab metadata={metadata} profile={profile} />}
      </div>
    </PanelSection>
  )
}

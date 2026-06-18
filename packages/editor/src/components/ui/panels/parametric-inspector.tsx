'use client'

import {
  type AnyNode,
  type AnyNodeId,
  type IconRef,
  type ItemNode,
  nodeRegistry,
  type ParamField,
  useScene,
  type ZoneNode,
} from '@pascal-app/core'
import { createModelNodes } from '@pascal-app/articraft-bridge/scene-converter'
import type { ArticraftModelData } from '@pascal-app/articraft-bridge/types'
import { useViewer } from '@pascal-app/viewer'
import { Icon } from '@iconify/react'
import { ExternalLink, Move, Pause, Play, RotateCcw, Save, Trash2 } from 'lucide-react'
import { type ComponentType, lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import {
  applyArticraftJointValue,
  buildArticraftJointPatch,
  formatJointUnit,
  getArticraftJointMetadata,
  getNodeMetadata,
  jointRange,
  parseArticraftPose,
  type ArticraftJointMetadata,
} from '../../../lib/articraft-joints'
import { isPlanDragMovableNode } from '../../../lib/plan-drag'
import { sfxEmitter } from '../../../lib/sfx-bus'
import useEditor from '../../../store/use-editor'
import { ActionButton, ActionGroup } from '../controls/action-button'
import { NodeMaterialSection } from '../controls/node-material-section'
import { PanelSection } from '../controls/panel-section'
import { SegmentedControl } from '../controls/segmented-control'
import { SliderControl } from '../controls/slider-control'
import { ToggleControl } from '../controls/toggle-control'
import { PanelWrapper } from './panel-wrapper'

/**
 * Auto-derived right-panel inspector for any registry-backed node.
 *
 * Reads `definition.parametrics` from the registry and renders one
 * `<PanelSection>` per group, one control per field. Field kinds supported:
 * - `number` → SliderControl with min/max/step/unit from the descriptor
 * - `enum`   → dark-themed `<select>`
 * - `color`  → native color picker + hex input
 * - `vec3`   → three SliderControls for X / Y / Z
 *
 * Generic Actions section appends Move / Delete based on `capabilities`.
 *
 * Phase 4 will expand this with per-field `customEditor` support and a
 * `parametrics.customPanel?` escape hatch for kinds whose parametric editor
 * can't be auto-generated (topology editors etc.).
 */
export function ParametricInspector() {
  const selectedId = useViewer(
    (s) => (s.selection.selectedIds[0] ?? s.selection.zoneId) as AnyNodeId | undefined,
  )
  const setSelection = useViewer((s) => s.setSelection)
  // Subscribe only to the *type* — a string primitive that doesn't change
  // when slider values change. Without this, every updateNode tick during
  // a drag re-renders the entire panel + every field + every SliderControl.
  // Per-field subscriptions live on FieldRenderer below.
  const nodeType = useScene((s) => (selectedId ? (s.nodes[selectedId]?.type ?? null) : null))

  const def = nodeType ? nodeRegistry.get(nodeType) : undefined
  const parametrics = def?.parametrics

  const handleUpdate = useCallback(
    (patch: Partial<AnyNode>) => {
      if (!selectedId) return
      useScene.getState().updateNode(selectedId, patch)
    },
    [selectedId],
  )

  const handleClose = useCallback(() => {
    setSelection({ selectedIds: [], zoneId: null })
  }, [setSelection])

  const handleMove = useCallback(() => {
    if (!selectedId) return
    const node = useScene.getState().nodes[selectedId]
    if (!node) return
    sfxEmitter.emit('sfx:item-pick')
    useEditor.getState().setMovingNode(node as any)
    setSelection({ selectedIds: [], zoneId: null })
  }, [selectedId, setSelection])

  const handleDelete = useCallback(() => {
    if (!selectedId) return
    sfxEmitter.emit('sfx:structure-delete')
    useScene.getState().deleteNode(selectedId)
    setSelection({ selectedIds: [], zoneId: null })
  }, [selectedId, setSelection])

  if (!selectedId || !def) return null

  // `parametrics.customPanel` escape hatch — kind owns its panel
  // entirely (loaded lazily so the bundle isn't eager). Used by kinds
  // whose editor has non-parametric concerns (slab holes list, ceiling
  // height presets, etc.) until per-field `customEditor` + missing
  // field kinds (list/action/computed) graduate the auto-derived
  // panel to cover them.
  if (parametrics?.customPanel) {
    const CustomPanel = resolveCustomPanel(parametrics.customPanel)
    return (
      <Suspense fallback={null}>
        <CustomPanel />
      </Suspense>
    )
  }

  const presentation = def.presentation
  const title = translateNodeLabel(presentation?.label ?? nodeType ?? '')
  const iconNode = renderIcon(presentation?.icon)
  const node = selectedId ? (useScene.getState().nodes[selectedId] ?? null) : null
  const canMove = !!def.capabilities.movable && !(node && isPlanDragMovableNode(node))
  const canDelete = def.capabilities.deletable !== false

  return (
    <PanelWrapper icon={iconNode} onClose={handleClose} title={title} width={320}>
      {parametrics?.groups.map((group, gi) => (
        <PanelSection key={`group-${gi}`} title={translatePanelGroupLabel(group.label)}>
          {group.fields.map((field, fi) => (
            <FieldRenderer
              key={`field-${gi}-${fi}-${String(field.key)}`}
              field={field as ParamField<AnyNode>}
              nodeId={selectedId}
              onUpdate={handleUpdate}
            />
          ))}
        </PanelSection>
      ))}
      {nodeType === 'zone' && <ZonePropertiesSection nodeId={selectedId} />}
      <NodeMaterialSection nodeId={selectedId} />
      <ArticraftModelSection nodeId={selectedId} />
      <ArticraftJointSection nodeId={selectedId} />
      {(canMove || canDelete) && (
        <PanelSection title="操作">
          <ActionGroup>
            {canMove && (
              <ActionButton icon={<Move className="h-4 w-4" />} label="移动" onClick={handleMove} />
            )}
            {canDelete && (
              <ActionButton
                className="border-red-500/40 text-red-200 hover:bg-red-500/15"
                icon={<Trash2 className="h-4 w-4" />}
                label="删除"
                onClick={handleDelete}
              />
            )}
          </ActionGroup>
        </PanelSection>
      )}
    </PanelWrapper>
  )
}

type ZoneMetadataValue = string | boolean | number | null
type ZoneMetadata = Record<string, ZoneMetadataValue>

const ZONE_TYPE_OPTIONS = [
  { value: 'production', label: 'Production', color: '#2563eb' },
  { value: 'warehouse', label: 'Warehouse', color: '#f59e0b' },
  { value: 'logistics', label: 'Logistics', color: '#0ea5e9' },
  { value: 'equipment', label: 'Equipment', color: '#8b5cf6' },
  { value: 'safety', label: 'Safety', color: '#22c55e' },
  { value: 'restricted', label: 'Restricted', color: '#ef4444' },
] as const

const ZONE_SAFETY_OPTIONS = [
  { value: 'normal', label: 'Normal' },
  { value: 'caution', label: 'Caution' },
  { value: 'danger', label: 'Danger' },
  { value: 'restricted', label: 'Restricted' },
] as const

function readZoneMetadata(metadata: ZoneNode['metadata']): ZoneMetadata {
  return metadata && typeof metadata === 'object' && !Array.isArray(metadata)
    ? (metadata as ZoneMetadata)
    : {}
}

function polygonArea(polygon: Array<[number, number]>): number {
  if (polygon.length < 3) return 0
  let area = 0
  for (let i = 0; i < polygon.length; i++) {
    const [x1, z1] = polygon[i]!
    const [x2, z2] = polygon[(i + 1) % polygon.length]!
    area += x1 * z2 - x2 * z1
  }
  return Math.abs(area) / 2
}

function ZonePropertiesSection({ nodeId }: { nodeId: AnyNodeId }) {
  const zone = useScene((s) => s.nodes[nodeId] as ZoneNode | undefined)

  const updateZone = useCallback(
    (patch: Partial<ZoneNode>) => {
      useScene.getState().updateNode(nodeId, patch as Partial<AnyNode>)
    },
    [nodeId],
  )

  if (!zone || zone.type !== 'zone') return null

  const metadata = readZoneMetadata(zone.metadata)
  const zoneType = typeof metadata.zoneType === 'string' ? metadata.zoneType : ''
  const safetyLevel =
    typeof metadata.safetyLevel === 'string' ? metadata.safetyLevel : 'normal'
  const notes = typeof metadata.notes === 'string' ? metadata.notes : ''
  const responsibleTeam =
    typeof metadata.responsibleTeam === 'string' ? metadata.responsibleTeam : ''
  const allowPeople =
    typeof metadata.allowPeople === 'boolean' ? metadata.allowPeople : true
  const allowForklift =
    typeof metadata.allowForklift === 'boolean' ? metadata.allowForklift : false
  const allowRobot = typeof metadata.allowRobot === 'boolean' ? metadata.allowRobot : false
  const noStorage = typeof metadata.noStorage === 'boolean' ? metadata.noStorage : false

  const updateMetadata = (patch: ZoneMetadata) => {
    updateZone({ metadata: { ...metadata, ...patch } as ZoneNode['metadata'] })
  }

  const handleZoneTypeChange = (value: string) => {
    const option = ZONE_TYPE_OPTIONS.find((item) => item.value === value)
    updateZone({
      color: option?.color ?? zone.color,
      metadata: { ...metadata, zoneType: value } as ZoneNode['metadata'],
    })
  }

  return (
    <>
      <PanelSection title="区域">
        <div className="space-y-3 px-3 py-2 text-xs">
          <label className="grid gap-1.5">
            <span className="text-muted-foreground">名称</span>
            <input
              className="h-8 rounded-md border border-border/50 bg-[#2C2C2E] px-2 text-foreground outline-none focus:ring-1 focus:ring-foreground/30"
              onChange={(event) => updateZone({ name: event.target.value })}
              type="text"
              value={zone.name ?? ''}
            />
          </label>
          <div className="flex items-center justify-between gap-2">
            <span className="text-muted-foreground">面积</span>
            <span className="font-mono text-foreground">{polygonArea(zone.polygon).toFixed(1)} m²</span>
          </div>
          <label className="flex items-center justify-between gap-2">
            <span className="text-muted-foreground">颜色</span>
            <div className="flex items-center gap-2">
              <input
                className="h-7 w-9 cursor-pointer rounded border border-border/50 bg-transparent"
                onChange={(event) => updateZone({ color: event.target.value })}
                type="color"
                value={zone.color}
              />
              <input
                className="w-20 rounded-md border border-border/50 bg-[#2C2C2E] px-2 py-1 text-foreground text-xs outline-none focus:ring-1 focus:ring-foreground/30"
                onChange={(event) => updateZone({ color: event.target.value })}
                type="text"
                value={zone.color}
              />
            </div>
          </label>
        </div>
      </PanelSection>
      <PanelSection title="工业属性">
        <div className="space-y-3 px-3 py-2 text-xs">
          <label className="grid gap-1.5">
            <span className="text-muted-foreground">类型</span>
            <select
              className="h-8 rounded-md border border-border/50 bg-[#2C2C2E] px-2 text-foreground outline-none focus:ring-1 focus:ring-foreground/30"
              onChange={(event) => handleZoneTypeChange(event.target.value)}
              value={zoneType}
            >
              <option value="">未指定</option>
              {ZONE_TYPE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1.5">
            <span className="text-muted-foreground">安全等级</span>
            <select
              className="h-8 rounded-md border border-border/50 bg-[#2C2C2E] px-2 text-foreground outline-none focus:ring-1 focus:ring-foreground/30"
              onChange={(event) => updateMetadata({ safetyLevel: event.target.value })}
              value={safetyLevel}
            >
              {ZONE_SAFETY_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1.5">
            <span className="text-muted-foreground">负责团队</span>
            <input
              className="h-8 rounded-md border border-border/50 bg-[#2C2C2E] px-2 text-foreground outline-none focus:ring-1 focus:ring-foreground/30"
              onChange={(event) => updateMetadata({ responsibleTeam: event.target.value })}
              placeholder="EHS / 生产 / 仓储"
              type="text"
              value={responsibleTeam}
            />
          </label>
          <div className="grid grid-cols-2 gap-2">
            <ToggleControl
              checked={allowPeople}
              label="人员"
              onChange={(next) => updateMetadata({ allowPeople: next })}
            />
            <ToggleControl
              checked={allowForklift}
              label="叉车"
              onChange={(next) => updateMetadata({ allowForklift: next })}
            />
            <ToggleControl
              checked={allowRobot}
              label="机器人"
              onChange={(next) => updateMetadata({ allowRobot: next })}
            />
            <ToggleControl
              checked={noStorage}
              label="禁止存储"
              onChange={(next) => updateMetadata({ noStorage: next })}
            />
          </div>
          <label className="grid gap-1.5">
            <span className="text-muted-foreground">备注</span>
            <textarea
              className="min-h-20 resize-y rounded-md border border-border/50 bg-[#2C2C2E] px-2 py-1.5 text-foreground outline-none focus:ring-1 focus:ring-foreground/30"
              onChange={(event) => updateMetadata({ notes: event.target.value })}
              placeholder="规则、风险、运行限制…"
              value={notes}
            />
          </label>
        </div>
      </PanelSection>
    </>
  )
}

type ArticraftModelMetadata = {
  recordId: string
  recordPath?: string
  prompt?: string
  joints?: unknown[]
  modelData?: ArticraftModelData
  viewerParams?: unknown
  viewerEffects?: unknown
}

type BridgeJointMetadata = ReturnType<typeof createModelNodes>['jointMetadata'][string]

function getRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function isArticraftModelData(value: unknown): value is ArticraftModelData {
  const record = getRecord(value)
  return !!(
    record &&
    typeof record.recordId === 'string' &&
    typeof record.name === 'string' &&
    Array.isArray(record.links) &&
    Array.isArray(record.joints) &&
    Array.isArray(record.meshes)
  )
}

function canConvertArticraftModel(modelData: ArticraftModelData): boolean {
  if (modelData.joints.length === 0 || modelData.links.length === 0) return false
  return modelData.links.every((link) =>
    link.visuals.some((visual) => visual.geometry.type !== 'mesh'),
  )
}

function readArticraftModelMetadata(node: AnyNode | undefined): ArticraftModelMetadata | null {
  if (!node) return null
  const metadata = getNodeMetadata(node)
  const nodeArticraft = getRecord(metadata.articraft)
  const asset =
    node.type === 'item'
      ? ((node as ItemNode).asset as ItemNode['asset'] & { articraft?: unknown })
      : null
  const assetArticraft = getRecord(asset?.articraft)
  const source = nodeArticraft ?? assetArticraft
  const recordId = typeof source?.recordId === 'string' ? source.recordId : ''
  if (!recordId) return null

  const modelData =
    isArticraftModelData(source?.modelData)
      ? source.modelData
      : isArticraftModelData(assetArticraft?.modelData)
        ? assetArticraft.modelData
        : undefined

  return {
    recordId,
    recordPath: typeof source?.recordPath === 'string' ? source.recordPath : undefined,
    prompt: typeof source?.prompt === 'string' ? source.prompt : undefined,
    joints: Array.isArray(source?.joints) ? source.joints : undefined,
    modelData,
    viewerParams: source?.viewerParams,
    viewerEffects: source?.viewerEffects,
  }
}

function getArticraftViewerUrl(recordId: string, tab = 'inspect'): string {
  const base = (process.env.NEXT_PUBLIC_ARTICRAFT_VIEWER_URL ?? 'http://127.0.0.1:8765').replace(
    /\/$/,
    '',
  )
  return `${base}/viewer?record=${encodeURIComponent(recordId)}&tab=${encodeURIComponent(tab)}`
}

function toSceneJointMetadata(jointMetadata: BridgeJointMetadata): ArticraftJointMetadata {
  return {
    jointName: jointMetadata.jointName,
    jointType: jointMetadata.jointType,
    parentLink: jointMetadata.parentLink,
    childLink: jointMetadata.childLink,
    axis: jointMetadata.axis,
    origin: jointMetadata.origin,
    ...(jointMetadata.limits ? { limits: jointMetadata.limits } : {}),
    ...(jointMetadata.mimic ? { mimic: jointMetadata.mimic } : {}),
    currentValue: jointMetadata.currentValue,
  }
}

function applyArticraftPoseToScene(recordId: string, rawValue: string | null): number {
  const pose = parseArticraftPose(rawValue, recordId)
  if (pose.size === 0) return 0

  const scene = useScene.getState()
  const updates = Object.values(scene.nodes).flatMap((node) => {
    const metadata = getNodeMetadata(node)
    const articraft = getRecord(metadata.articraft)
    const joint = getArticraftJointMetadata(node)
    if (!joint || articraft?.recordId !== recordId) return []
    const value = pose.get(joint.jointName)
    if (value == null) return []
    return [{ id: node.id as AnyNodeId, data: applyArticraftJointValue(node, joint, value) }]
  })

  if (updates.length > 0) {
    scene.updateNodes(updates)
    useViewer.getState().setSelection({ selectedIds: [updates[0]!.id] })
  }
  return updates.length
}

function rawPoseFromViewerMessage(data: unknown, recordId: string): string | null {
  const message = getRecord(data)
  if (!message) return null
  const type = typeof message.type === 'string' ? message.type : ''
  const messageRecordId = typeof message.recordId === 'string' ? message.recordId : recordId
  const hasPosePayload = message.pose != null || message.values != null || message.joints != null
  const isArticraftPose =
    type === 'articraft:pose' ||
    type === 'articraft-viewer:pose' ||
    type === 'articraft.pose' ||
    hasPosePayload
  if (!isArticraftPose || messageRecordId !== recordId) return null
  if (typeof message.url === 'string') return message.url
  return JSON.stringify({
    recordId,
    pose: message.pose ?? message.values ?? message.joints,
  })
}

function viewerSettingsFromMessage(data: unknown, recordId: string): Record<string, unknown> | null {
  const message = getRecord(data)
  if (!message) return null
  const messageRecordId = typeof message.recordId === 'string' ? message.recordId : recordId
  if (messageRecordId !== recordId) return null
  const viewerParams = message.params ?? message.parameters ?? message.settings
  const viewerEffects = message.effects ?? message.materials ?? message.rendering
  if (viewerParams == null && viewerEffects == null) return null
  return {
    ...(viewerParams != null ? { viewerParams } : {}),
    ...(viewerEffects != null ? { viewerEffects } : {}),
    viewerSyncedAt: new Date().toISOString(),
  }
}

function syncArticraftViewerSettings(recordId: string, settings: Record<string, unknown>): number {
  const scene = useScene.getState()
  const updates = Object.values(scene.nodes).flatMap((node) => {
    const metadata = getNodeMetadata(node)
    const articraft = getRecord(metadata.articraft)
    if (articraft?.recordId !== recordId) return []
    return [{
      id: node.id as AnyNodeId,
      data: ({
        metadata: {
          ...metadata,
          articraft: {
            ...articraft,
            ...settings,
          },
        },
      } as unknown) as Partial<AnyNode>,
    }]
  })
  if (updates.length > 0) {
    scene.updateNodes(updates)
  }
  return updates.length
}

function inferArticraftLinkName(nodeName: string | undefined, fallback: string): string {
  return (nodeName ?? fallback).replace(/_v\d+$/, '')
}

function ArticraftModelSection({ nodeId }: { nodeId: AnyNodeId }) {
  const node = useScene((s) => s.nodes[nodeId])
  const metadata = useMemo(() => readArticraftModelMetadata(node), [node])
  const [status, setStatus] = useState<string | null>(null)

  const openViewer = useCallback(() => {
    if (!metadata) return
    window.open(getArticraftViewerUrl(metadata.recordId), '_blank', 'noopener,noreferrer')
  }, [metadata])

  const applyPoseFromClipboard = useCallback(async () => {
    if (!metadata) return
    const clipboardText = await navigator.clipboard?.readText?.().catch(() => '')
    const source = clipboardText || window.location.href
    const applied = applyArticraftPoseToScene(metadata.recordId, source)
    setStatus(applied > 0 ? `Applied pose to ${applied} joint${applied === 1 ? '' : 's'}.` : 'No matching pose values found.')
  }, [metadata])

  const convertToArticulated = useCallback(() => {
    if (!node || node.type !== 'item' || !metadata?.modelData) return
    const scene = useScene.getState()
    const selectedParentId = (node.parentId as AnyNodeId | null) ?? undefined
    const created = createModelNodes(
      metadata.modelData,
      (nextNode, parentId) => {
        scene.createNode(nextNode, parentId)
        return nextNode.id as AnyNodeId
      },
      {
        articulationMode: metadata.modelData.joints.length > 0,
        parentId: selectedParentId,
        rootPosition: node.position,
      },
    )

    const metadataUpdates = created.nodeIds.flatMap((id) => {
      const createdNode = useScene.getState().nodes[id as AnyNodeId]
      if (!createdNode) return []
      const existingMetadata = getNodeMetadata(createdNode)
      const linkName = inferArticraftLinkName(createdNode.name, id)
      const jointMetadata = created.jointMetadata[id]
      const articraftMetadata = {
        recordId: metadata.recordId,
        recordPath: metadata.recordPath,
        prompt: metadata.prompt,
        joints: metadata.joints,
        jointName: jointMetadata?.jointName ?? null,
        parentLink: jointMetadata?.parentLink ?? null,
        childLink: jointMetadata?.childLink ?? linkName,
        ...(created.rootNodeIds.includes(id) ? { modelData: metadata.modelData } : {}),
      }
      return [{
        id: id as AnyNodeId,
        data: ({
          metadata: {
            ...existingMetadata,
            articraft: articraftMetadata,
            ...(jointMetadata ? { articraftJoint: toSceneJointMetadata(jointMetadata) } : {}),
          },
        } as unknown) as Partial<AnyNode>,
      }]
    })

    if (metadataUpdates.length > 0) {
      useScene.getState().updateNodes(metadataUpdates)
    }

    useScene.getState().deleteNode(node.id as AnyNodeId)

    const selectedRootId = created.rootNodeIds[0] ?? created.nodeIds[0]
    if (selectedRootId) {
      useViewer.getState().setSelection({ selectedIds: [selectedRootId as AnyNodeId] })
    }
    setStatus(`Converted to ${created.nodeIds.length} articulated node${created.nodeIds.length === 1 ? '' : 's'}.`)
  }, [metadata, node])

  useEffect(() => {
    if (!metadata) return
    const handler = (event: MessageEvent) => {
      const rawValue = rawPoseFromViewerMessage(event.data, metadata.recordId)
      const settings = viewerSettingsFromMessage(event.data, metadata.recordId)
      const applied = rawValue ? applyArticraftPoseToScene(metadata.recordId, rawValue) : 0
      const synced = settings ? syncArticraftViewerSettings(metadata.recordId, settings) : 0
      if (!rawValue && !settings) return
      if (applied > 0 && synced > 0) {
        setStatus(`Synced ${applied} joint${applied === 1 ? '' : 's'} and Viewer settings.`)
      } else if (applied > 0) {
        setStatus(`Synced ${applied} joint${applied === 1 ? '' : 's'} from Viewer.`)
      } else if (synced > 0) {
        setStatus('Synced Viewer settings.')
      } else {
        setStatus('Viewer message had no matching scene nodes.')
      }
    }
    window.addEventListener('message', handler)
    return () => window.removeEventListener('message', handler)
  }, [metadata])

  if (!metadata) return null

  const canConvert = node?.type === 'item' && !!metadata.modelData && canConvertArticraftModel(metadata.modelData)
  const jointCount = metadata.modelData?.joints.length ?? metadata.joints?.length ?? 0

  return (
    <PanelSection title="Articraft 模型">
      <div className="space-y-2 px-3 py-1 text-xs">
        <div className="truncate font-mono text-[10px] text-muted-foreground">
          record {metadata.recordId}
        </div>
        {metadata.recordPath ? (
          <div className="truncate font-mono text-[10px] text-muted-foreground" title={metadata.recordPath}>
            path {metadata.recordPath}
          </div>
        ) : null}
        <div className="flex items-center justify-between gap-2 text-muted-foreground">
          <span>关节</span>
          <span className="font-mono text-foreground">{jointCount}</span>
        </div>
        <div className="flex items-center justify-between gap-2 text-muted-foreground">
          <span>画布模型</span>
          <span className="font-mono text-foreground">
            {canConvert ? 'split-link ready' : 'single GLB item'}
          </span>
        </div>
        {metadata.viewerParams != null || metadata.viewerEffects != null ? (
          <div className="flex items-center justify-between gap-2 text-muted-foreground">
            <span>查看器设置</span>
            <span className="font-mono text-foreground">
              {metadata.viewerParams != null ? 'params' : ''}
              {metadata.viewerParams != null && metadata.viewerEffects != null ? ' / ' : ''}
              {metadata.viewerEffects != null ? 'effects' : ''}
            </span>
          </div>
        ) : null}
        {metadata.prompt ? (
          <div className="line-clamp-3 text-muted-foreground" title={metadata.prompt}>
            {metadata.prompt}
          </div>
        ) : null}
        {status ? <div className="text-[11px] text-[#a684ff]">{status}</div> : null}
      </div>
      <ActionGroup>
        <ActionButton
          icon={<ExternalLink className="h-4 w-4" />}
          label="打开查看器"
          onClick={openViewer}
        />
        <ActionButton
          icon={<Save className="h-4 w-4" />}
          label="应用查看器姿态"
          onClick={applyPoseFromClipboard}
        />
        {canConvert ? (
          <ActionButton
            icon={<Icon className="h-4 w-4" icon="mdi:robot-industrial" />}
            label="转为可动模型"
            onClick={convertToArticulated}
          />
        ) : null}
      </ActionGroup>
    </PanelSection>
  )
}

function ArticraftJointSection({ nodeId }: { nodeId: AnyNodeId }) {
  const joint = useScene((s) => getArticraftJointMetadata(s.nodes[nodeId]))
  const recordId = useScene((s) => {
    const metadata = s.nodes[nodeId]?.metadata
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null
    const articraft = (metadata as Record<string, unknown>).articraft
    if (!articraft || typeof articraft !== 'object' || Array.isArray(articraft)) return null
    const value = (articraft as Record<string, unknown>).recordId
    return typeof value === 'string' ? value : null
  })
  const [previewing, setPreviewing] = useState(false)
  const [min, max] = useMemo(() => (joint ? jointRange(joint) : [0, 0] as [number, number]), [joint])

  const updateJoint = useCallback(
    (patch: Partial<ArticraftJointMetadata>) => {
      const node = useScene.getState().nodes[nodeId]
      if (!node) return
      const current = getArticraftJointMetadata(node)
      if (!current) return
      useScene.getState().updateNode(nodeId, buildArticraftJointPatch(node, current, patch))
    },
    [nodeId],
  )

  useEffect(() => {
    if (!previewing || !joint) return
    const startedAt = performance.now()
    const interval = window.setInterval(() => {
      const span = max - min
      const midpoint = min + span / 2
      const value = midpoint + Math.sin((performance.now() - startedAt) / 700) * (span / 2)
      updateJoint({ currentValue: Math.round(value * 1000) / 1000 })
    }, 80)
    return () => window.clearInterval(interval)
  }, [joint, max, min, previewing, updateJoint])

  useEffect(() => {
    if (!joint) setPreviewing(false)
  }, [joint])

  if (!joint) return null

  const value = typeof joint.currentValue === 'number' ? joint.currentValue : 0
  const isMovable = joint.jointType !== 'fixed'
  const openViewer = () => {
    if (!recordId) return
    const base = (process.env.NEXT_PUBLIC_ARTICRAFT_VIEWER_URL ?? 'http://127.0.0.1:8765').replace(
      /\/$/,
      '',
    )
    window.open(
      `${base}/viewer?record=${encodeURIComponent(recordId)}&tab=inspect`,
      '_blank',
      'noopener,noreferrer',
    )
  }

  return (
    <PanelSection title="Articraft 关节">
      <div className="space-y-2 px-3 py-1 text-xs">
        <div className="flex items-center justify-between gap-2">
          <span className="truncate font-mono text-muted-foreground" title={joint.jointName}>
            {joint.jointName}
          </span>
          <span className="rounded border border-border/60 px-1.5 py-0.5 text-[10px] text-muted-foreground">
            {joint.jointType ?? 'joint'}
          </span>
        </div>
        {joint.parentLink || joint.childLink ? (
          <div className="grid gap-1 font-mono text-[10px] text-muted-foreground">
            {joint.parentLink ? <div>parent {joint.parentLink}</div> : null}
            {joint.childLink ? <div>child {joint.childLink}</div> : null}
          </div>
        ) : null}
        {joint.axis ? (
          <div className="font-mono text-[10px] text-muted-foreground">
            axis [{joint.axis.map((item) => Number(item).toFixed(2)).join(', ')}]
          </div>
        ) : null}
        {joint.limits ? (
          <div className="font-mono text-[10px] text-muted-foreground">
            limits [{min.toFixed(3)}, {max.toFixed(3)}]
            {typeof joint.limits.velocity === 'number' ? ` · v ${joint.limits.velocity}` : ''}
            {typeof joint.limits.effort === 'number' ? ` · effort ${joint.limits.effort}` : ''}
          </div>
        ) : null}
        {recordId ? (
          <div className="truncate font-mono text-[10px] text-muted-foreground">
            record {recordId}
          </div>
        ) : null}
      </div>
      {isMovable ? (
        <SliderControl
          label="当前值"
          max={max}
          min={min}
          onChange={(next) => updateJoint({ currentValue: next })}
          precision={3}
          step={0.01}
          unit={formatJointUnit(joint)}
          value={value}
        />
      ) : null}
      <ActionGroup>
        {recordId && (
          <ActionButton
            icon={<ExternalLink className="h-4 w-4" />}
            label="打开查看器"
            onClick={openViewer}
          />
        )}
        <ActionButton
          icon={<RotateCcw className="h-4 w-4" />}
          label="重置关节"
          onClick={() => updateJoint({ currentValue: 0 })}
        />
        <ActionButton
          icon={<Save className="h-4 w-4" />}
          label="保存姿态"
          onClick={() => updateJoint({ savedValue: value })}
        />
        <ActionButton
          icon={previewing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
          label={previewing ? '停止预览' : '自动预览'}
          onClick={() => setPreviewing((next) => !next)}
        />
      </ActionGroup>
    </PanelSection>
  )
}

function renderIcon(ref: IconRef | undefined): React.ReactNode | undefined {
  if (!ref) return undefined
  if (ref.kind === 'url') {
    // Plain <img> here so the inspector doesn't pull in next/image's
    // server-only requirements (the file is `'use client'`). Same
    // 16x16 box the legacy panels use.
    return <img alt="" className="h-4 w-4 shrink-0 object-contain" src={ref.src} />
  }
  if (ref.kind === 'iconify') {
    return <Icon height={16} icon={ref.name} width={16} />
  }
  if (ref.kind === 'svg') {
    return (
      <svg height={16} viewBox={ref.viewBox} width={16}>
        <path d={ref.path} fill="currentColor" />
      </svg>
    )
  }
  // `component`: lazy-loaded custom icon component. Suspense-safe.
  const LazyIcon = lazy(ref.module)
  return (
    <Suspense fallback={null}>
      <LazyIcon />
    </Suspense>
  )
}

// Cache lazy custom panel components by their loader so React.lazy isn't
// re-invoked across renders.
const customPanelCache = new WeakMap<() => Promise<unknown>, ComponentType>()

function resolveCustomPanel(loader: () => Promise<{ default: ComponentType<any> }>): ComponentType {
  const cached = customPanelCache.get(loader)
  if (cached) return cached
  const Comp = lazy(loader)
  customPanelCache.set(loader, Comp as ComponentType)
  return Comp as ComponentType
}

// ─── Per-field renderers ─────────────────────────────────────────────

interface FieldRendererProps {
  field: ParamField<AnyNode>
  nodeId: AnyNodeId
  onUpdate: (patch: Partial<AnyNode>) => void
}

function FieldRenderer({ field, nodeId, onUpdate }: FieldRendererProps) {
  const key = String(field.key)
  // Subscribe only to this field's value. Zustand compares with ===, so when
  // another field on the same node changes (which produces a new node object
  // reference), this primitive value stays equal and the field doesn't
  // re-render. Vec3 arrays get a new reference only when the array itself
  // changes — same outcome.
  const value = useScene((s) => {
    const n = s.nodes[nodeId]
    return n ? (n as Record<string, unknown>)[key] : undefined
  })
  // visibleIf may consult other fields on the node — subscribe to its boolean
  // result so we re-evaluate when relevant.
  const visible = useScene((s) => {
    const visibleIf = (field as { visibleIf?: (n: AnyNode) => boolean }).visibleIf
    if (!visibleIf) return true
    const n = s.nodes[nodeId]
    return n ? visibleIf(n as AnyNode) : false
  })
  if (!visible) return null

  switch (field.kind) {
    case 'number': {
      const num = typeof value === 'number' ? value : 0
      const step = field.step ?? 0.01
      const precision = precisionForStep(step)
      return (
        <SliderControl
          label={prettifyKey(key)}
          max={field.max}
          min={field.min}
          onChange={(next) => onUpdate({ [key]: next } as Partial<AnyNode>)}
          precision={precision}
          step={step}
          unit={field.unit ?? ''}
          value={num}
        />
      )
    }

    case 'boolean': {
      const checked = value === true
      return (
        <ToggleControl
          checked={checked}
          label={prettifyKey(key)}
          onChange={(next) => onUpdate({ [key]: next } as Partial<AnyNode>)}
        />
      )
    }

    case 'enum': {
      const str = typeof value === 'string' ? value : (field.options[0] ?? '')
      if (field.display === 'segmented') {
        return (
          <SegmentedControl
            onChange={(next) => onUpdate({ [key]: next } as Partial<AnyNode>)}
            options={field.options.map((opt) => ({ label: prettifyEnumValue(opt), value: opt }))}
            value={str}
          />
        )
      }
      return (
        <div className="flex items-center justify-between px-3 py-2">
          <span className="text-foreground/80 text-xs">{prettifyKey(key)}</span>
          <select
            className="rounded-md border border-border/50 bg-[#2C2C2E] px-2 py-1 text-foreground text-xs focus:outline-none focus:ring-1 focus:ring-foreground/30"
            onChange={(e) => onUpdate({ [key]: e.target.value } as Partial<AnyNode>)}
            value={str}
          >
            {field.options.map((opt) => (
              <option key={opt} value={opt}>
                {prettifyEnumValue(opt)}
              </option>
            ))}
          </select>
        </div>
      )
    }

    case 'color': {
      const str = typeof value === 'string' ? value : '#888888'
      return (
        <div className="flex items-center justify-between px-3 py-2">
          <span className="text-foreground/80 text-xs">{prettifyKey(key)}</span>
          <div className="flex items-center gap-2">
            <input
              className="h-6 w-8 cursor-pointer rounded border border-border/50 bg-transparent"
              onChange={(e) => onUpdate({ [key]: e.target.value } as Partial<AnyNode>)}
              type="color"
              value={str}
            />
            <input
              className="w-20 rounded-md border border-border/50 bg-[#2C2C2E] px-2 py-1 text-foreground text-xs focus:outline-none focus:ring-1 focus:ring-foreground/30"
              onChange={(e) => onUpdate({ [key]: e.target.value } as Partial<AnyNode>)}
              type="text"
              value={str}
            />
          </div>
        </div>
      )
    }

    case 'vec3': {
      const v = Array.isArray(value) && value.length >= 3
        ? (value as [number, number, number])
        : [0, 0, 0]
      const axes: Array<{ label: string; index: 0 | 1 | 2 }> = [
        { label: 'X', index: 0 },
        { label: 'Y', index: 1 },
        { label: 'Z', index: 2 },
      ]
      return (
        <>
          {axes.map(({ label, index }) => {
            // v is a [number, number, number] tuple; the explicit local
            // resolves TS's noUncheckedIndexedAccess concern that v[index]
            // could be undefined.
            const axisValue = v[index] ?? 0
            return (
              <SliderControl
                key={`${key}-${label}`}
                label={label}
                max={axisValue + 5}
                min={axisValue - 5}
                onChange={(next) => {
                  const updated = [...v] as [number, number, number]
                  updated[index] = next
                  onUpdate({ [key]: updated } as Partial<AnyNode>)
                }}
                precision={2}
                step={0.05}
                unit="m"
                value={Math.round(axisValue * 100) / 100}
              />
            )
          })}
        </>
      )
    }

    case 'custom':
      // The field owns its rendering and update logic — used for
      // derived values (length from start/end), dynamic-bounded
      // sliders (curve sagitta), composed editors.
      return <CustomFieldRenderer Comp={field.component} nodeId={nodeId} onUpdate={onUpdate} />

    default:
      // material / ref / unrecognized kinds — not implemented in v1.
      return null
  }
}

function CustomFieldRenderer({
  Comp,
  nodeId,
  onUpdate,
}: {
  Comp: ComponentType<{ node: AnyNode; onUpdate: (patch: Partial<AnyNode>) => void }>
  nodeId: AnyNodeId
  onUpdate: (patch: Partial<AnyNode>) => void
}) {
  // Subscribe to the full node — the custom editor may read any
  // field. Tools that don't want this churn should write narrower
  // selectors inside Comp itself.
  const node = useScene((s) => s.nodes[nodeId])
  if (!node) return null
  return <Comp node={node} onUpdate={onUpdate} />
}

// ─── helpers ─────────────────────────────────────────────────────────

function precisionForStep(step: number): number {
  if (step <= 0) return 0
  return Math.max(0, Math.ceil(-Math.log10(step)))
}



const NODE_LABELS: Record<string, string> = {
  'Cable Tray': '桥架',
  'Pipe fitting': '管件',
  'Steel Beam': '钢梁',
  Tank: '储罐',
  'Data Widget': '数据组件',
  Shelf: '货架',
  'cable-tray': '桥架',
  'pipe-fitting': '管件',
  'steel-beam': '钢梁',
  tank: '储罐',
  'data-widget': '数据组件',
  shelf: '货架',
}

const PANEL_GROUP_LABELS: Record<string, string> = {
  Dimensions: '尺寸',
  Rungs: '横档',
  Appearance: '外观',
  Fitting: '管件',
  Process: '工艺',
  Profile: '型材',
  Tank: '储罐',
  Widget: '组件',
  Style: '类型',
  Position: '位置',
  Actions: '操作',
  Topology: '结构',
}

const FIELD_LABELS: Record<string, string> = {
  width: '宽度',
  depth: '深度',
  sideHeight: '侧边高度',
  thickness: '厚度',
  rows: '层数',
  columns: '列数',
  withSides: '侧板',
  withBack: '背板',
  withBottom: '底板',
  bracketStyle: '支架样式',
  style: '类型',
  elevation: '标高',
  curveOffset: '曲线偏移',
  showRungs: '显示横档',
  rungSpacing: '横档间距',
  color: '颜色',
  fittingKind: '管件类型',
  angleDegrees: '角度',
  diameter: '直径',
  bendRadiusMultiplier: '弯曲半径倍数',
  branchLength: '支管长度',
  length: '长度',
  flangeOuterDiameter: '法兰外径',
  flangeThickness: '法兰厚度',
  boltCount: '螺栓数量',
  boltDiameter: '螺栓直径',
  valveStyle: '阀门样式',
  medium: '介质',
  pressureKpa: '压力 kPa',
  temperatureC: '\u6e29\u5ea6 \u00b0C',
  insulated: '保温',
  insulationThickness: '保温厚度',
  profile: '型材',
  height: '高度',
  webThickness: '腹板厚度',
  kind: '类型',
  liquidLevel: '液位',
  shellColor: '罐体颜色',
  liquidColor: '液体颜色',
  shellOpacity: '罐体透明度',
}

const ENUM_LABELS: Record<string, string> = {
  elbow: '弯头',
  tee: '三通',
  cross: '四通',
  flange: '法兰',
  valve: '阀门',
  placeholder: '占位',
  gate: '闸阀',
  ball: '球阀',
  butterfly: '蝶阀',
  steam: '蒸汽',
  condensate: '冷凝水',
  water: '水',
  'i-beam': '工字钢',
  box: '箱型',
  channel: '槽钢',
  concave: '凹型',
  vertical: '立式',
  horizontal: '卧式',
  spherical: '球形',
  production: '生产',
  warehouse: '仓储',
  logistics: '物流',
  equipment: '设备',
  safety: '安全',
  restricted: '受限',
  normal: '正常',
  caution: '警示',
  danger: '危险',
  'wall-shelf': '壁挂架',
  bookshelf: '书架',
  'open-rack': '仓储货架',
  cubby: '格子架',
  minimal: '简洁',
  industrial: '工业',
  hidden: '隐藏',
}

function translateNodeLabel(label: string): string {
  return NODE_LABELS[label] ?? label
}

function translatePanelGroupLabel(label: string): string {
  return PANEL_GROUP_LABELS[label] ?? label
}

function prettifyKey(key: string): string {
  const mapped = FIELD_LABELS[key]
  if (mapped) return mapped
  const spaced = key.replace(/([A-Z])/g, ' $1').toLowerCase()
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

function prettifyEnumValue(value: string): string {
  const mapped = ENUM_LABELS[value]
  if (mapped) return mapped
  return value
    .split(/[-_\s]/)
    .map((word, i) =>
      i === 0 ? word.charAt(0).toUpperCase() + word.slice(1) : word.toLowerCase(),
    )
    .join(' ')
}

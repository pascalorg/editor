'use client'

import {
  DYNAMIC_TYPE_LABELS,
  type AnyNode,
  type AnyNodeId,
  type DynamicBinding,
  type DynamicJointBinding,
  type DynamicJointChannel,
  type DynamicType,
  type LiveDataPath,
  formatLiveDataValue,
  getDynamicTypesForNode,
  getNodeSemanticType,
  getRecommendedDynamicTypeForNode,
  readDynamicMetadata,
  SEMANTIC_DYNAMIC_TYPES,
  SEMANTIC_TYPE_LABELS,
  useLiveData,
  useScene,
  writeDynamicMetadataPatch,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { Plus } from 'lucide-react'
import { useCallback, useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { PanelSection } from '../../controls/panel-section'
import {
  getArticraftJointChannelsForSelection,
  getArticraftRecordIdForSelection,
} from '../../../../lib/articraft-dynamic-channels'
import { createBinding, isConveyorSemanticType } from './binding-defaults'
import { DynamicBindingCard } from './dynamic-binding-card'
import { NumberField, type PathOption, SelectField } from './fields'

const SEMANTIC_TYPE_OPTIONS = [
  'generic',
  'pipe',
  'conveyor',
  'tank',
  'fan',
  'motor',
  'roller',
  'valve',
  'pump',
  'light',
  'display',
]

function metadataRecord(node: AnyNode): Record<string, unknown> {
  return node.metadata && typeof node.metadata === 'object' && !Array.isArray(node.metadata)
    ? (node.metadata as Record<string, unknown>)
    : {}
}

function createJointBinding(channel: DynamicJointChannel, path: string): DynamicJointBinding {
  const id =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `joint_${Date.now()}_${Math.random().toString(16).slice(2)}`
  return {
    id,
    channelId: channel.id,
    path,
    inputRange: channel.inputRange ?? [0, 100],
    outputRange: channel.outputRange ?? (channel.motion === 'rotation' ? [0, Math.PI / 2] : [0, 1]),
    enabled: true,
  }
}

function JointBindingsSection({
  channels,
  bindings,
  pathOptions,
  title = '关节动态',
  onWriteBindings,
}: {
  channels: DynamicJointChannel[]
  bindings: DynamicJointBinding[]
  pathOptions: PathOption[]
  title?: string
  onWriteBindings: (bindings: DynamicJointBinding[]) => void
}) {
  if (channels.length === 0) return null
  const bindingsByChannel = new Map(bindings.map((binding) => [binding.channelId, binding]))
  const defaultPath = pathOptions[0]?.path ?? ''

  const upsertBinding = (channel: DynamicJointChannel, patch: Partial<DynamicJointBinding>) => {
    const current = bindingsByChannel.get(channel.id) ?? createJointBinding(channel, defaultPath)
    const nextBinding = { ...current, ...patch }
    const next = bindings.filter((binding) => binding.channelId !== channel.id)
    onWriteBindings([...next, nextBinding])
  }

  const updateRange = (
    channel: DynamicJointChannel,
    binding: DynamicJointBinding | undefined,
    key: 'inputRange' | 'outputRange',
    index: 0 | 1,
    value: number,
  ) => {
    const fallback =
      key === 'inputRange'
        ? channel.inputRange ?? [0, 100]
        : channel.outputRange ?? (channel.motion === 'rotation' ? [0, Math.PI / 2] : [0, 1])
    const current = binding?.[key] ?? fallback
    upsertBinding(channel, {
      [key]: [index === 0 ? value : current[0], index === 1 ? value : current[1]],
    })
  }

  return (
    <PanelSection title={title} defaultExpanded>
      <div className="flex flex-col gap-2">
        {channels.map((channel) => {
          const binding = bindingsByChannel.get(channel.id)
          const pathValues = pathOptions.map((option) => option.path)
          const selectedPath = binding?.path ?? defaultPath
          const selectPathOptions =
            selectedPath && !pathValues.includes(selectedPath)
              ? [selectedPath, ...pathValues]
              : pathValues
          return (
            <div
              className="flex flex-col gap-2 rounded-lg border border-border/45 bg-[#252527] p-2"
              data-testid="dynamic-joint-binding-card"
              key={channel.id}
            >
              <div className="flex items-center justify-between gap-2 text-xs">
                <div className="min-w-0">
                  <div className="truncate font-medium text-foreground">{channel.label}</div>
                  {channel.source ? (
                    <div className="truncate text-[10px] text-muted-foreground">
                      原始名称：{channel.source}
                    </div>
                  ) : null}
                </div>
                <div className="shrink-0 text-muted-foreground">
                  {channel.motion === 'rotation' ? '旋转' : '平移'} · {channel.axis.toUpperCase()}
                </div>
              </div>
              <SelectField
                getLabel={(path) => pathOptions.find((option) => option.path === path)?.label ?? path}
                label="数据路径"
                onChange={(path) => upsertBinding(channel, { path })}
                options={selectPathOptions}
                value={selectedPath}
              />
              <div className="grid grid-cols-2 gap-2">
                <NumberField
                  label="输入最小"
                  onChange={(value) => updateRange(channel, binding, 'inputRange', 0, value)}
                  value={binding?.inputRange?.[0] ?? channel.inputRange?.[0] ?? 0}
                />
                <NumberField
                  label="输入最大"
                  onChange={(value) => updateRange(channel, binding, 'inputRange', 1, value)}
                  value={binding?.inputRange?.[1] ?? channel.inputRange?.[1] ?? 100}
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <NumberField
                  label={channel.motion === 'rotation' ? '角度最小' : '位移最小'}
                  onChange={(value) => updateRange(channel, binding, 'outputRange', 0, value)}
                  value={
                    binding?.outputRange?.[0] ??
                    channel.outputRange?.[0] ??
                    0
                  }
                />
                <NumberField
                  label={channel.motion === 'rotation' ? '角度最大' : '位移最大'}
                  onChange={(value) => updateRange(channel, binding, 'outputRange', 1, value)}
                  value={
                    binding?.outputRange?.[1] ??
                    channel.outputRange?.[1] ??
                    (channel.motion === 'rotation' ? Math.PI / 2 : 1)
                  }
                />
              </div>
            </div>
          )
        })}
      </div>
    </PanelSection>
  )
}

function DeviceTypeSection({
  dynamicTypes,
  recommendedType,
  semanticType,
  specializedTypes,
  onSemanticTypeChange,
  lockedSemanticType = false,
}: {
  dynamicTypes: DynamicType[]
  recommendedType: DynamicType
  semanticType: string
  specializedTypes: readonly DynamicType[]
  onSemanticTypeChange: (semanticType: string) => void
  lockedSemanticType?: boolean
}) {
  return (
    <PanelSection title="设备类型" defaultExpanded>
      <SelectField
        getLabel={(type) => SEMANTIC_TYPE_LABELS[type] ?? type}
        label="语义类型"
        disabled={lockedSemanticType}
        onChange={lockedSemanticType ? () => undefined : onSemanticTypeChange}
        options={lockedSemanticType ? [semanticType] : SEMANTIC_TYPE_OPTIONS}
        testId="dynamic-semantic-type-select"
        value={semanticType}
      />
      <div className="rounded-md border border-border/35 bg-[#252527] px-2 py-1.5 text-muted-foreground text-xs">
        推荐动态：
        <span className="ml-1 text-foreground">
          {specializedTypes.length > 0
            ? specializedTypes.map((type) => DYNAMIC_TYPE_LABELS[type] ?? type).join(' / ')
            : DYNAMIC_TYPE_LABELS[recommendedType]}
        </span>
      </div>
    </PanelSection>
  )
}

function ArticraftDeviceSection({ recordId }: { recordId: string | null }) {
  return (
    <PanelSection title="设备类型" defaultExpanded>
      <div className="flex flex-col gap-2">
        <div className="rounded-md border border-border/35 bg-[#252527] px-2 py-1.5 text-xs">
          <div className="flex items-center justify-between gap-2">
            <span className="text-muted-foreground">语义类型</span>
            <span className="font-medium text-foreground">关节资产</span>
          </div>
          {recordId ? (
            <div className="mt-1 truncate font-mono text-[10px] text-muted-foreground">
              记录：{recordId}
            </div>
          ) : null}
        </div>
        <div className="rounded-md border border-[#a684ff]/25 bg-[#3A3358]/35 px-2 py-1.5 text-[#E8DEFF] text-[11px] leading-4">
          从 Articraft 生成的 URDF 关节自动提取，绑定 WebSocket 数据后在预览模式驱动设备运动。
        </div>
      </div>
    </PanelSection>
  )
}

function BindingsSection({
  bindings,
  dynamicTypes,
  isConveyorNode,
  isPipeNode,
  livePaths,
  pathOptions,
  onAddBinding,
  onWriteBindings,
}: {
  bindings: DynamicBinding[]
  dynamicTypes: DynamicType[]
  isConveyorNode: boolean
  isPipeNode: boolean
  livePaths: LiveDataPath[]
  pathOptions: PathOption[]
  onAddBinding: (type?: DynamicType) => void
  onWriteBindings: (bindings: DynamicBinding[]) => void
}) {
  return (
    <PanelSection title="动态" defaultExpanded>
      <div className="grid grid-cols-1 gap-2">
        <button
          className="flex h-8 items-center justify-center gap-1.5 rounded-md bg-[#3A3358] font-medium text-[#E8DEFF] text-[11px] transition hover:bg-[#463a6b] disabled:opacity-50"
          data-testid="dynamic-add-recommended"
          disabled={pathOptions.length === 0}
          onClick={() => onAddBinding()}
          type="button"
        >
          <Plus className="h-3.5 w-3.5" />
          添加类型
        </button>
      </div>
      {pathOptions.length === 0 ? (
        <div className="rounded-lg border border-border/40 bg-[#252527] p-3 text-muted-foreground text-xs">
          暂无可绑定数据路径。未连接 WebSocket 时会使用静态示例数据；如果这里为空，请检查数据源服务。
        </div>
      ) : null}
      {bindings.length === 0 ? (
        <div className="rounded-lg border border-border/40 bg-[#252527] p-3 text-muted-foreground text-xs">
          还没有动态绑定。普通物体只显示通用动态；输送带、管道、储罐、风机等设备会自动追加对应专用动态。
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {bindings.map((binding, index) => (
            <DynamicBindingCard
              binding={binding}
              dynamicTypes={dynamicTypes}
              isConveyorNode={isConveyorNode}
              isPipeNode={isPipeNode}
              key={binding.id}
              onChange={(nextBinding) => {
                const next = [...bindings]
                next[index] = nextBinding
                onWriteBindings(next)
              }}
              onRemove={() => onWriteBindings(bindings.filter((item) => item.id !== binding.id))}
              pathOptions={pathOptions}
            />
          ))}
        </div>
      )}
    </PanelSection>
  )
}

export function DynamicInspector() {
  const selectedId = useViewer((s) => s.selection.selectedIds[0])
  const node = useScene((s) =>
    selectedId ? (s.nodes[selectedId as AnyNodeId] as AnyNode | undefined) : undefined,
  )
  const sceneNodes = useScene((s) => s.nodes as Record<string, AnyNode>)
  const updateNode = useScene((s) => s.updateNode)
  const { paths: livePaths, values } = useLiveData(
    useShallow((s) => ({
      paths: s.paths,
      values: s.values,
    })),
  )
  const dynamicMetadata = useMemo(() => readDynamicMetadata(node), [node])
  const nativeSemanticType = node?.type === 'pipe' ? 'pipe' : node?.type === 'tank' ? 'tank' : null
  const lockedSemanticType = nativeSemanticType !== null
  const semanticType = nativeSemanticType ?? (node ? getNodeSemanticType(node) : 'generic')
  const dynamicTypes = useMemo(() => getDynamicTypesForNode(node), [node])
  const recommendedType = useMemo(() => getRecommendedDynamicTypeForNode(node), [node])
  const specializedTypes = SEMANTIC_DYNAMIC_TYPES[semanticType] ?? []
  const isConveyorNode = isConveyorSemanticType(semanticType)
  const isPipeNode = node?.type === 'pipe' || semanticType === 'pipe'
  const pathOptions = useMemo<PathOption[]>(
    () =>
      livePaths.map((path) => {
        const valueText = formatLiveDataValue(values[path.path], path.unit)
        return {
          path: path.path,
          category: path.category,
          label: `${path.label} · ${valueText} · ${path.path}`,
          valueText,
        }
      }),
    [livePaths, values],
  )
  const bindings = useMemo(
    () =>
      (dynamicMetadata.dynamicBindings ?? []).filter((binding) =>
        dynamicTypes.includes(binding.type),
      ),
    [dynamicMetadata.dynamicBindings, dynamicTypes],
  )
  const articraftRecordId = useMemo(
    () => getArticraftRecordIdForSelection(node, sceneNodes),
    [node, sceneNodes],
  )
  const articraftJointChannels = useMemo(
    () => getArticraftJointChannelsForSelection(node, sceneNodes),
    [node, sceneNodes],
  )
  const isArticraftJointAsset = articraftJointChannels.length > 0
  const jointChannels = isArticraftJointAsset
    ? articraftJointChannels
    : dynamicMetadata.jointChannels ?? []
  const jointBindings = dynamicMetadata.jointBindings ?? []
  const writeBindings = useCallback(
    (nextBindings: DynamicBinding[]) => {
      if (!node) return
      updateNode(
        node.id as AnyNodeId,
        writeDynamicMetadataPatch(node, { dynamicBindings: nextBindings }) as Partial<AnyNode>,
      )
    },
    [node, updateNode],
  )
  const writeJointBindings = useCallback(
    (nextJointBindings: DynamicJointBinding[]) => {
      if (!node) return
      updateNode(
        node.id as AnyNodeId,
        writeDynamicMetadataPatch(node, {
          jointChannels,
          jointBindings: nextJointBindings,
        }) as Partial<AnyNode>,
      )
    },
    [jointChannels, node, updateNode],
  )
  const setSemanticType = useCallback(
    (nextSemanticType: string) => {
      if (!node) return
      updateNode(node.id as AnyNodeId, {
        metadata: { ...metadataRecord(node), semanticType: nextSemanticType },
      } as Partial<AnyNode>)
    },
    [node, updateNode],
  )
  const addBinding = useCallback(
    (type: DynamicType = recommendedType) => {
      const path =
        pathOptions.find((option) => option.category === semanticType)?.path ??
        pathOptions[0]?.path ??
        ''
      writeBindings([...bindings, createBinding(type, path)])
    },
    [bindings, pathOptions, recommendedType, semanticType, writeBindings],
  )

  if (!node) {
    return (
      <PanelSection title="动态">
        <div className="rounded-lg border border-border/40 bg-[#252527] p-3 text-muted-foreground text-xs">
          请选择一个画布物品后配置动态。
        </div>
      </PanelSection>
    )
  }

  return (
    <div data-testid="dynamic-inspector">
      {isArticraftJointAsset ? (
        <ArticraftDeviceSection recordId={articraftRecordId} />
      ) : (
        <DeviceTypeSection
          dynamicTypes={dynamicTypes}
          lockedSemanticType={lockedSemanticType}
          onSemanticTypeChange={setSemanticType}
          recommendedType={recommendedType}
          semanticType={semanticType}
          specializedTypes={specializedTypes}
        />
      )}
      <JointBindingsSection
        bindings={jointBindings}
        channels={jointChannels}
        onWriteBindings={writeJointBindings}
        pathOptions={pathOptions}
        title={isArticraftJointAsset ? '关节动态' : undefined}
      />
      {isArticraftJointAsset ? null : (
        <BindingsSection
          bindings={bindings}
          dynamicTypes={dynamicTypes}
          isConveyorNode={isConveyorNode}
          isPipeNode={isPipeNode}
          livePaths={livePaths}
          onAddBinding={addBinding}
          onWriteBindings={writeBindings}
          pathOptions={pathOptions}
        />
      )}
    </div>
  )
}

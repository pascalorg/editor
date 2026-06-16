'use client'

import {
  type AnyNodeId,
  formatStaticLiveDataValue,
  type LiveDataBindingConfig,
  resolveBindingPreview,
  STATIC_LIVE_DATA_OPTIONS,
} from '@pascal-app/core'
import { PanelSection, SegmentedControl, ToggleControl } from '@pascal-app/editor'

type BindableNode = {
  id: AnyNodeId
  metadata?: unknown
}

type DataBindingSectionProps<TNode extends BindableNode> = {
  node: TNode
  onUpdate: (updates: Partial<TNode>) => void
}

const DEFAULT_BINDING: LiveDataBindingConfig = {
  enabled: false,
  dataKey: 'machine.status',
  effect: 'color',
}

function readBinding(node: BindableNode): LiveDataBindingConfig {
  const metadata =
    node.metadata && typeof node.metadata === 'object' && !Array.isArray(node.metadata)
      ? (node.metadata as Record<string, unknown>)
      : null
  const value = metadata?.liveDataBinding
  if (value && typeof value === 'object') {
    return { ...DEFAULT_BINDING, ...(value as Partial<LiveDataBindingConfig>) }
  }
  return DEFAULT_BINDING
}

export function DataBindingSection<TNode extends BindableNode>({
  node,
  onUpdate,
}: DataBindingSectionProps<TNode>) {
  const binding = readBinding(node)

  const patchBinding = (updates: Partial<LiveDataBindingConfig>) => {
    const metadata =
      node.metadata && typeof node.metadata === 'object' && !Array.isArray(node.metadata)
        ? (node.metadata as Record<string, unknown>)
        : {}
    onUpdate({
      metadata: {
        ...metadata,
        liveDataBinding: { ...binding, ...updates },
      },
    } as unknown as Partial<TNode>)
  }

  return (
    <PanelSection title="数据绑定">
      <ToggleControl
        checked={binding.enabled === true}
        label="启用静态绑定"
        onChange={(enabled) => patchBinding({ enabled })}
      />
      <label className="flex flex-col gap-1 text-muted-foreground text-xs">
        数据字段
        <select
          className="h-9 rounded-lg border border-border/50 bg-[#2C2C2E] px-2 text-foreground"
          onChange={(event) =>
            patchBinding({ dataKey: event.target.value as LiveDataBindingConfig['dataKey'] })
          }
          value={binding.dataKey}
        >
          {STATIC_LIVE_DATA_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label} ({formatStaticLiveDataValue(option.value)})
            </option>
          ))}
        </select>
      </label>
      <SegmentedControl
        onChange={(effect) => patchBinding({ effect })}
        options={[
          { label: '颜色', value: 'color' },
          { label: '绕 Y 旋转', value: 'rotation-y' },
          { label: '沿 Y 移动', value: 'position-y' },
        ]}
        value={binding.effect}
      />
      <div className="rounded-lg border border-border/50 bg-[#2C2C2E] px-3 py-2 text-muted-foreground text-xs">
        静态预览：{resolveBindingPreview(binding)}
      </div>
    </PanelSection>
  )
}

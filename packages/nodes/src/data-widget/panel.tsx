'use client'

import {
  type AnyNode,
  type DataWidgetNode,
  formatStaticLiveDataValue,
  STATIC_LIVE_DATA_OPTIONS,
  useScene,
} from '@pascal-app/core'
import {
  ActionButton,
  ActionGroup,
  MetricControl,
  PanelSection,
  PanelWrapper,
  SegmentedControl,
  SliderControl,
  triggerSFX,
} from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { Trash2 } from 'lucide-react'
import { useCallback } from 'react'

export default function DataWidgetPanel() {
  const selectedId = useViewer((s) => s.selection.selectedIds[0])
  const selectedCount = useViewer((s) => s.selection.selectedIds.length)
  const setSelection = useViewer((s) => s.setSelection)
  const updateNode = useScene((s) => s.updateNode)
  const deleteNode = useScene((s) => s.deleteNode)
  const node = useScene((s) =>
    selectedId ? (s.nodes[selectedId as AnyNode['id']] as DataWidgetNode | undefined) : undefined,
  )

  const handleUpdate = useCallback(
    (updates: Partial<DataWidgetNode>) => {
      if (!selectedId) return
      updateNode(selectedId as AnyNode['id'], updates)
    },
    [selectedId, updateNode],
  )

  const handleDelete = useCallback(() => {
    if (!selectedId) return
    triggerSFX('sfx:item-delete')
    deleteNode(selectedId as AnyNode['id'])
    setSelection({ selectedIds: [] })
  }, [deleteNode, selectedId, setSelection])

  if (!(node && node.type === 'data-widget' && selectedId && selectedCount === 1)) return null

  return (
    <PanelWrapper
      icon="/icons/data-widget.svg"
      onClose={() => setSelection({ selectedIds: [] })}
      title={node.name || '数据组件'}
      width={300}
    >
      <PanelSection title="组件">
        <SegmentedControl
          onChange={(widgetType) => handleUpdate({ widgetType })}
          options={[
            { label: '标签', value: 'label' },
            { label: '徽章', value: 'badge' },
            { label: '卡片', value: 'card' },
          ]}
          value={node.widgetType}
        />
        <label className="flex flex-col gap-1 text-muted-foreground text-xs">
          数据字段
          <select
            className="h-9 rounded-lg border border-border/50 bg-[#2C2C2E] px-2 text-foreground"
            onChange={(event) => handleUpdate({ dataKey: event.target.value })}
            value={node.dataKey}
          >
            {STATIC_LIVE_DATA_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label} ({formatStaticLiveDataValue(option.value)})
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-muted-foreground text-xs">
          模板
          <input
            className="h-9 rounded-lg border border-border/50 bg-[#2C2C2E] px-2 text-foreground"
            onChange={(event) => handleUpdate({ template: event.target.value })}
            value={node.template}
          />
        </label>
        {node.widgetType === 'card' ? (
          <label className="flex flex-col gap-1 text-muted-foreground text-xs">
            标题
            <input
              className="h-9 rounded-lg border border-border/50 bg-[#2C2C2E] px-2 text-foreground"
              onChange={(event) => handleUpdate({ title: event.target.value })}
              value={node.title}
            />
          </label>
        ) : null}
      </PanelSection>

      <PanelSection title="样式">
        <MetricControl
          label="字号"
          max={48}
          min={10}
          onChange={(fontSize) => handleUpdate({ fontSize })}
          precision={0}
          step={1}
          unit="px"
          value={node.fontSize}
        />
        <div className="grid grid-cols-2 gap-2">
          <label className="flex flex-col gap-1 text-muted-foreground text-xs">
            文字
            <input
              type="color"
              value={node.foreground}
              onChange={(e) => handleUpdate({ foreground: e.target.value })}
            />
          </label>
          <label className="flex flex-col gap-1 text-muted-foreground text-xs">
            背景
            <input
              type="color"
              value={node.background}
              onChange={(e) => handleUpdate({ background: e.target.value })}
            />
          </label>
        </div>
      </PanelSection>

      <PanelSection title="位置">
        <SliderControl
          label="X"
          max={50}
          min={-50}
          onChange={(x) => handleUpdate({ position: [x, node.position[1], node.position[2]] })}
          precision={2}
          step={0.05}
          unit="m"
          value={node.position[0]}
        />
        <SliderControl
          label="Y"
          max={50}
          min={-50}
          onChange={(y) => handleUpdate({ position: [node.position[0], y, node.position[2]] })}
          precision={2}
          step={0.05}
          unit="m"
          value={node.position[1]}
        />
        <SliderControl
          label="Z"
          max={50}
          min={-50}
          onChange={(z) => handleUpdate({ position: [node.position[0], node.position[1], z] })}
          precision={2}
          step={0.05}
          unit="m"
          value={node.position[2]}
        />
      </PanelSection>

      <PanelSection title="操作">
        <ActionGroup>
          <ActionButton
            className="hover:bg-red-500/20"
            icon={<Trash2 className="h-3.5 w-3.5 text-red-400" />}
            label="删除"
            onClick={handleDelete}
          />
        </ActionGroup>
      </PanelSection>
    </PanelWrapper>
  )
}

'use client'

import { type AnyNode, type DataChartNode, useLiveData, useScene } from '@pascal-app/core'
import {
  ActionButton,
  ActionGroup,
  ColorAlphaField,
  MetricControl,
  PanelSection,
  PanelWrapper,
  SegmentedControl,
  SliderControl,
  triggerSFX,
} from '@pascal-app/editor'
import useViewer from '@pascal-app/viewer/store'
import { Plus, Trash2, X } from 'lucide-react'
import { useCallback } from 'react'
import { formatLiveDataPathOption } from '../shared/live-data-format'

function DataKeySelect({
  onChange,
  options,
  value,
  values,
}: {
  onChange: (value: string) => void
  options: ReturnType<typeof useLiveData.getState>['paths']
  value: string
  values: ReturnType<typeof useLiveData.getState>['values']
}) {
  return (
    <select
      className="h-9 w-full min-w-0 flex-1 rounded-lg border border-border/50 bg-[#2C2C2E] px-2 text-foreground text-xs"
      onChange={(event) => onChange(event.target.value)}
      value={value}
    >
      {options.map((option) => (
        <option key={option.path} value={option.path}>
          {formatLiveDataPathOption(options, values, option.path)}
        </option>
      ))}
    </select>
  )
}

export default function DataChartPanel() {
  const selectedId = useViewer((s) => s.selection.selectedIds[0])
  const selectedCount = useViewer((s) => s.selection.selectedIds.length)
  const setSelection = useViewer((s) => s.setSelection)
  const updateNode = useScene((s) => s.updateNode)
  const deleteNode = useScene((s) => s.deleteNode)
  const paths = useLiveData((s) => s.paths)
  const values = useLiveData((s) => s.values)
  const node = useScene((s) =>
    selectedId ? (s.nodes[selectedId as AnyNode['id']] as DataChartNode | undefined) : undefined,
  )

  const handleUpdate = useCallback(
    (updates: Partial<DataChartNode>) => {
      if (!selectedId) return
      updateNode(selectedId as AnyNode['id'], updates)
    },
    [selectedId, updateNode],
  )

  const handleDataKeyChange = useCallback(
    (index: number, dataKey: string) => {
      if (!node) return
      handleUpdate({
        dataKeys: node.dataKeys.map((current, currentIndex) =>
          currentIndex === index ? dataKey : current,
        ),
      })
    },
    [handleUpdate, node],
  )

  const handleAddKey = useCallback(() => {
    if (!node) return
    const nextKey =
      paths.find((option) => !node.dataKeys.includes(option.path))?.path ??
      paths[0]?.path ??
      'machine.temperature'
    handleUpdate({ dataKeys: [...node.dataKeys, nextKey].slice(0, 8) })
  }, [handleUpdate, node, paths])

  const handleRemoveKey = useCallback(
    (index: number) => {
      if (!node || node.dataKeys.length <= 1) return
      handleUpdate({ dataKeys: node.dataKeys.filter((_, currentIndex) => currentIndex !== index) })
    },
    [handleUpdate, node],
  )

  const handleDelete = useCallback(() => {
    if (!selectedId) return
    triggerSFX('sfx:item-delete')
    deleteNode(selectedId as AnyNode['id'])
    setSelection({ selectedIds: [] })
  }, [deleteNode, selectedId, setSelection])

  if (!(node && node.type === 'data-chart' && selectedId && selectedCount === 1)) return null
  const pathOptions = [
    ...node.dataKeys
      .filter((dataKey) => !paths.some((path) => path.path === dataKey))
      .map((dataKey) => ({ path: dataKey, label: dataKey, valueType: 'string' as const })),
    ...paths,
  ]

  return (
    <PanelWrapper
      icon="/icons/data-chart.svg"
      onClose={() => setSelection({ selectedIds: [] })}
      title={node.name || '图表控件'}
      width={300}
    >
      <PanelSection title="图表">
        <SegmentedControl
          onChange={(chartType) => handleUpdate({ chartType })}
          options={[
            { label: '柱状图', value: 'bar' },
            { label: '曲线图', value: 'line' },
          ]}
          value={node.chartType}
        />
        <label className="flex flex-col gap-1 text-muted-foreground text-xs">
          标题
          <input
            className="h-9 rounded-lg border border-border/50 bg-[#2C2C2E] px-2 text-foreground"
            onChange={(event) => handleUpdate({ title: event.target.value })}
            value={node.title}
          />
        </label>
      </PanelSection>

      <PanelSection title="数据">
        <div className="space-y-2">
          {node.dataKeys.map((dataKey, index) => (
            <div className="flex items-center gap-2" key={`${index}:${dataKey}`}>
              <DataKeySelect
                value={dataKey}
                options={pathOptions}
                values={values}
                onChange={(value) => handleDataKeyChange(index, value)}
              />
              <button
                aria-label="移除数据"
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-white/10 hover:text-foreground disabled:opacity-40"
                disabled={node.dataKeys.length <= 1}
                onClick={() => handleRemoveKey(index)}
                type="button"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
        <ActionButton
          disabled={node.dataKeys.length >= 8}
          icon={<Plus className="h-3.5 w-3.5" />}
          label="添加数据"
          onClick={handleAddKey}
        />
      </PanelSection>

      <PanelSection title="样式">
        <MetricControl
          label="字号"
          max={32}
          min={10}
          onChange={(fontSize) => handleUpdate({ fontSize })}
          precision={0}
          step={1}
          unit="px"
          value={node.fontSize}
        />
        <ColorAlphaField
          label={'\u80cc\u666f'}
          opacity={node.backgroundOpacity ?? 1}
          value={node.background ?? '#111827'}
          onColorChange={(background) => handleUpdate({ background })}
          onOpacityChange={(backgroundOpacity) => handleUpdate({ backgroundOpacity })}
        />
        <div className="grid grid-cols-2 gap-2">
          <label className="flex flex-col gap-1 text-muted-foreground text-xs">
            {'\u6587\u5b57'}
            <input
              type="color"
              value={node.foreground}
              onChange={(event) => handleUpdate({ foreground: event.target.value })}
            />
          </label>
          <label className="flex flex-col gap-1 text-muted-foreground text-xs">
            {'\u5f3a\u8c03'}
            <input
              type="color"
              value={node.accent}
              onChange={(event) => handleUpdate({ accent: event.target.value })}
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

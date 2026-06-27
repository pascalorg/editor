'use client'

import {
  type AnyNode,
  type DataTableNode,
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
  SliderControl,
  triggerSFX,
} from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { Plus, Trash2, X } from 'lucide-react'
import { useCallback } from 'react'

function DataKeySelect({ onChange, value }: { onChange: (value: string) => void; value: string }) {
  return (
    <select
      className="h-8 min-w-0 flex-1 rounded-md border border-border/50 bg-[#2C2C2E] px-2 text-foreground"
      onChange={(event) => onChange(event.target.value)}
      value={value}
    >
      {STATIC_LIVE_DATA_OPTIONS.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label} ({formatStaticLiveDataValue(option.value)})
        </option>
      ))}
    </select>
  )
}

export default function DataTablePanel() {
  const selectedId = useViewer((s) => s.selection.selectedIds[0])
  const selectedCount = useViewer((s) => s.selection.selectedIds.length)
  const setSelection = useViewer((s) => s.setSelection)
  const updateNode = useScene((s) => s.updateNode)
  const deleteNode = useScene((s) => s.deleteNode)
  const node = useScene((s) =>
    selectedId ? (s.nodes[selectedId as AnyNode['id']] as DataTableNode | undefined) : undefined,
  )

  const handleUpdate = useCallback(
    (updates: Partial<DataTableNode>) => {
      if (!selectedId) return
      updateNode(selectedId as AnyNode['id'], updates)
    },
    [selectedId, updateNode],
  )

  const handleRowChange = useCallback(
    (index: number, patch: Partial<DataTableNode['rows'][number]>) => {
      if (!node) return
      handleUpdate({
        rows: node.rows.map((row, currentIndex) =>
          currentIndex === index ? { ...row, ...patch } : row,
        ),
      })
    },
    [handleUpdate, node],
  )

  const handleAddRow = useCallback(() => {
    if (!node) return
    const nextOption =
      STATIC_LIVE_DATA_OPTIONS.find(
        (option) => !node.rows.some((row) => row.dataKey === option.value),
      ) ?? STATIC_LIVE_DATA_OPTIONS[0]
    handleUpdate({
      rows: [
        ...node.rows,
        {
          label: nextOption?.label ?? 'Metric',
          dataKey: nextOption?.value ?? 'machine.temperature',
        },
      ].slice(0, 8),
    })
  }, [handleUpdate, node])

  const handleRemoveRow = useCallback(
    (index: number) => {
      if (!node || node.rows.length <= 1) return
      handleUpdate({ rows: node.rows.filter((_, currentIndex) => currentIndex !== index) })
    },
    [handleUpdate, node],
  )

  const handleDelete = useCallback(() => {
    if (!selectedId) return
    triggerSFX('sfx:item-delete')
    deleteNode(selectedId as AnyNode['id'])
    setSelection({ selectedIds: [] })
  }, [deleteNode, selectedId, setSelection])

  if (!(node && node.type === 'data-table' && selectedId && selectedCount === 1)) return null

  return (
    <PanelWrapper
      icon="/icons/data-table.svg"
      onClose={() => setSelection({ selectedIds: [] })}
      title={node.name || '列表控件'}
      width={320}
    >
      <PanelSection title="列表">
        <label className="flex flex-col gap-1 text-muted-foreground text-xs">
          标题
          <input
            className="h-9 rounded-lg border border-border/50 bg-[#2C2C2E] px-2 text-foreground"
            onChange={(event) => handleUpdate({ title: event.target.value })}
            value={node.title}
          />
        </label>
      </PanelSection>

      <PanelSection title="数据行">
        <div className="space-y-2">
          {node.rows.map((row, index) => (
            <div className="space-y-1 rounded-md border border-border/40 p-2" key={index}>
              <div className="flex items-center gap-2">
                <input
                  className="h-8 min-w-0 flex-1 rounded-md border border-border/50 bg-[#2C2C2E] px-2 text-foreground"
                  onChange={(event) => handleRowChange(index, { label: event.target.value })}
                  value={row.label}
                />
                <button
                  aria-label="移除数据行"
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-white/10 hover:text-foreground disabled:opacity-40"
                  disabled={node.rows.length <= 1}
                  onClick={() => handleRemoveRow(index)}
                  type="button"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
              <DataKeySelect
                value={row.dataKey}
                onChange={(value) => handleRowChange(index, { dataKey: value })}
              />
            </div>
          ))}
        </div>
        <ActionButton
          disabled={node.rows.length >= 8}
          icon={<Plus className="h-3.5 w-3.5" />}
          label="添加数据行"
          onClick={handleAddRow}
        />
      </PanelSection>

      <PanelSection title="样式">
        <MetricControl
          label="字号"
          max={24}
          min={10}
          onChange={(fontSize) => handleUpdate({ fontSize })}
          precision={0}
          step={1}
          unit="px"
          value={node.fontSize}
        />
        <div className="grid grid-cols-3 gap-2">
          <label className="flex flex-col gap-1 text-muted-foreground text-xs">
            文字
            <input
              type="color"
              value={node.foreground}
              onChange={(event) => handleUpdate({ foreground: event.target.value })}
            />
          </label>
          <label className="flex flex-col gap-1 text-muted-foreground text-xs">
            背景
            <input
              type="color"
              value={node.background}
              onChange={(event) => handleUpdate({ background: event.target.value })}
            />
          </label>
          <label className="flex flex-col gap-1 text-muted-foreground text-xs">
            强调
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

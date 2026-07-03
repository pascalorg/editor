'use client'

import { type AnyNode, type DataWidgetNode, useLiveData, useScene } from '@pascal-app/core'
import {
  ActionButton,
  ActionGroup,
  ColorAlphaField,
  MetricControl,
  PanelSection,
  PanelWrapper,
  SliderControl,
  triggerSFX,
} from '@pascal-app/editor'
import useViewer from '@pascal-app/viewer/store'
import { Trash2 } from 'lucide-react'
import { useCallback } from 'react'
import { formatLiveDataPathOption } from '../shared/live-data-format'

export default function DataWidgetPanel() {
  const selectedId = useViewer((s) => s.selection.selectedIds[0])
  const selectedCount = useViewer((s) => s.selection.selectedIds.length)
  const setSelection = useViewer((s) => s.setSelection)
  const updateNode = useScene((s) => s.updateNode)
  const deleteNode = useScene((s) => s.deleteNode)
  const paths = useLiveData((s) => s.paths)
  const values = useLiveData((s) => s.values)
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
  const pathOptions = paths.some((path) => path.path === node.dataKey)
    ? paths
    : [{ path: node.dataKey, label: node.dataKey, valueType: 'string' as const }, ...paths]

  return (
    <PanelWrapper
      icon="/icons/data-widget.svg"
      onClose={() => setSelection({ selectedIds: [] })}
      title={node.name || '\u5355\u6807\u7b7e'}
      width={300}
    >
      <PanelSection title={'\u5355\u6807\u7b7e'}>
        <label className="flex flex-col gap-1 text-muted-foreground text-xs">
          模板
          <input
            className="h-10 w-full min-w-0 flex-1 rounded-lg border border-border/50 bg-[#2C2C2E] px-2 text-foreground text-xs"
            onChange={(event) => handleUpdate({ template: event.target.value })}
            value={node.template}
          />
        </label>
      </PanelSection>

      <PanelSection title={'\u6570\u636e'}>
        <label className="flex flex-col gap-1 text-muted-foreground text-xs">
          {'\u6570\u636e\u8def\u5f84'}
          <select
            className="h-9 w-full min-w-0 cursor-pointer rounded-md border border-border/60 bg-[#2C2C2E] px-3 pr-8 text-foreground text-xs leading-none outline-none focus:ring-1 focus:ring-foreground/30"
            data-testid="data-widget-path-select"
            onChange={(event) => handleUpdate({ dataKey: event.target.value })}
            onClick={(event) => event.stopPropagation()}
            onMouseDown={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
            value={node.dataKey}
          >
            {pathOptions.map((option) => (
              <option key={option.path} value={option.path}>
                {formatLiveDataPathOption(paths, values, option.path)}
              </option>
            ))}
          </select>
        </label>
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
              onChange={(e) => handleUpdate({ foreground: e.target.value })}
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

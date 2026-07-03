'use client'

import { type AnyNode, type TankNode, useScene } from '@pascal-app/core'
import {
  ActionButton,
  ActionGroup,
  MetricControl,
  PanelSection,
  PanelWrapper,
  SliderControl,
  triggerSFX,
  useEditor,
} from '@pascal-app/editor'
import useViewer from '@pascal-app/viewer/store'
import { Move, Trash2 } from 'lucide-react'
import { useCallback } from 'react'
import { L, S } from '../i18n/panel-labels'
import { TransformPanelSection } from '../shared/transform-panel-section'

const SELECT_CLASS =
  'h-10 w-full rounded-lg border border-border/50 bg-[#2C2C2E] px-3 text-sm text-foreground outline-none transition-colors hover:bg-[#3e3e3e] focus:ring-1 focus:ring-border'

const KIND_OPTIONS: Array<{ label: string; value: TankNode['kind'] }> = [
  { label: '立式储罐', value: 'vertical' },
  { label: '卧式储罐', value: 'horizontal' },
  { label: '球形储罐', value: 'spherical' },
]

function rounded(value: number, precision = 2) {
  const scale = 10 ** precision
  return Math.round(value * scale) / scale
}

export default function TankPanel() {
  const selectedId = useViewer((s) => s.selection.selectedIds[0])
  const selectedCount = useViewer((s) => s.selection.selectedIds.length)
  const setSelection = useViewer((s) => s.setSelection)
  const updateNode = useScene((s) => s.updateNode)
  const deleteNode = useScene((s) => s.deleteNode)
  const setMovingNode = useEditor((s) => s.setMovingNode)

  const node = useScene((s) =>
    selectedId ? (s.nodes[selectedId as AnyNode['id']] as TankNode | undefined) : undefined,
  )

  const handleUpdate = useCallback(
    (updates: Partial<TankNode>) => {
      if (!selectedId) return
      updateNode(selectedId as AnyNode['id'], updates)
    },
    [selectedId, updateNode],
  )

  const handleClose = useCallback(() => {
    setSelection({ selectedIds: [] })
  }, [setSelection])

  const handleMove = useCallback(() => {
    if (!node) return
    triggerSFX('sfx:item-pick')
    setMovingNode(node)
    setSelection({ selectedIds: [] })
  }, [node, setMovingNode, setSelection])

  const handleDelete = useCallback(() => {
    if (!(selectedId && node)) return
    triggerSFX('sfx:structure-delete')
    deleteNode(selectedId as AnyNode['id'])
    setSelection({ selectedIds: [] })
  }, [deleteNode, node, selectedId, setSelection])

  if (!(node && node.type === 'tank' && selectedId && selectedCount === 1)) return null

  return (
    <PanelWrapper
      icon="/icons/tank.svg"
      onClose={handleClose}
      title={node.name || '储罐'}
      width={320}
    >
      <PanelSection title="储罐">
        <select
          className={SELECT_CLASS}
          onChange={(event) => handleUpdate({ kind: event.target.value as TankNode['kind'] })}
          value={node.kind}
        >
          {KIND_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <SliderControl
          label="液位"
          max={1}
          min={0}
          onChange={(value) => handleUpdate({ liquidLevel: value })}
          precision={2}
          step={0.01}
          value={rounded(node.liquidLevel)}
        />
      </PanelSection>

      <PanelSection title={S.dimensions()}>
        <MetricControl
          label="直径"
          max={20}
          min={0.1}
          onChange={(value) => handleUpdate({ diameter: value })}
          precision={2}
          step={0.05}
          unit="m"
          value={rounded(node.diameter)}
        />
        {node.kind === 'vertical' ? (
          <MetricControl
            label={L.height()}
            max={40}
            min={0.1}
            onChange={(value) => handleUpdate({ height: value })}
            precision={2}
            step={0.05}
            unit="m"
            value={rounded(node.height)}
          />
        ) : null}
        {node.kind === 'horizontal' ? (
          <MetricControl
            label={L.length()}
            max={40}
            min={0.1}
            onChange={(value) => handleUpdate({ length: value })}
            precision={2}
            step={0.05}
            unit="m"
            value={rounded(node.length)}
          />
        ) : null}
      </PanelSection>

      <PanelSection title="外观">
        <label className="flex items-center justify-between px-3 py-2">
          <span className="text-foreground/80 text-xs">罐体颜色</span>
          <input
            className="h-7 w-10 cursor-pointer rounded border border-border/50 bg-transparent"
            onChange={(event) => handleUpdate({ shellColor: event.target.value })}
            type="color"
            value={node.shellColor}
          />
        </label>
        <label className="flex items-center justify-between px-3 py-2">
          <span className="text-foreground/80 text-xs">液体颜色</span>
          <input
            className="h-7 w-10 cursor-pointer rounded border border-border/50 bg-transparent"
            onChange={(event) => handleUpdate({ liquidColor: event.target.value })}
            type="color"
            value={node.liquidColor}
          />
        </label>
        <SliderControl
          label="罐体透明度"
          max={1}
          min={0.05}
          onChange={(value) => handleUpdate({ shellOpacity: value })}
          precision={2}
          step={0.05}
          value={rounded(node.shellOpacity)}
        />
      </PanelSection>

      <TransformPanelSection
        includeFlip={false}
        includeRotation
        node={node}
        nodeId={selectedId as AnyNode['id']}
        onUpdate={handleUpdate}
        rotationAxes={[1]}
      />

      <PanelSection title={S.actions()}>
        <ActionGroup>
          <ActionButton icon={<Move className="h-4 w-4" />} label={L.move()} onClick={handleMove} />
          <ActionButton
            className="border-red-500/40 text-red-200 hover:bg-red-500/15"
            icon={<Trash2 className="h-4 w-4" />}
            label={L.delete()}
            onClick={handleDelete}
          />
        </ActionGroup>
      </PanelSection>
    </PanelWrapper>
  )
}

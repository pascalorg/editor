'use client'

import { type AnyNode, type AnyNodeId, WindowNode, useScene } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { Copy, FlipHorizontal2, Move, Trash2 } from 'lucide-react'
import { useCallback } from 'react'
import { sfxEmitter } from '@/lib/sfx-bus'
import useEditor from '@/store/use-editor'

import { PanelWrapper } from './panel-wrapper'
import { PanelSection } from '../controls/panel-section'
import { SliderControl } from '../controls/slider-control'
import { MetricControl } from '../controls/metric-control'
import { ToggleControl } from '../controls/toggle-control'
import { ActionButton, ActionGroup } from '../controls/action-button'

export function WindowPanel() {
  const selectedIds = useViewer((s) => s.selection.selectedIds)
  const setSelection = useViewer((s) => s.setSelection)
  const nodes = useScene((s) => s.nodes)
  const updateNode = useScene((s) => s.updateNode)
  const deleteNode = useScene((s) => s.deleteNode)
  const setMovingNode = useEditor((s) => s.setMovingNode)

  const selectedId = selectedIds[0]
  const node = selectedId
    ? (nodes[selectedId as AnyNode['id']] as WindowNode | undefined)
    : undefined

  const handleUpdate = useCallback(
    (updates: Partial<WindowNode>) => {
      if (!selectedId) return
      updateNode(selectedId as AnyNode['id'], updates)
      useScene.getState().dirtyNodes.add(selectedId as AnyNodeId)
    },
    [selectedId, updateNode],
  )

  const handleClose = useCallback(() => {
    setSelection({ selectedIds: [] })
  }, [setSelection])

  const handleFlip = useCallback(() => {
    if (!node) return
    handleUpdate({
      side: node.side === 'front' ? 'back' : 'front',
      rotation: [node.rotation[0], node.rotation[1] + Math.PI, node.rotation[2]],
    })
  }, [node, handleUpdate])

  const handleMove = useCallback(() => {
    if (!node) return
    sfxEmitter.emit('sfx:item-pick')
    setMovingNode(node)
    setSelection({ selectedIds: [] })
  }, [node, setMovingNode, setSelection])

  const handleDelete = useCallback(() => {
    if (!selectedId || !node) return
    sfxEmitter.emit('sfx:item-delete')
    deleteNode(selectedId as AnyNode['id'])
    if (node.parentId) useScene.getState().dirtyNodes.add(node.parentId as AnyNodeId)
    setSelection({ selectedIds: [] })
  }, [selectedId, node, deleteNode, setSelection])

  const handleDuplicate = useCallback(() => {
    if (!node || !node.parentId) return
    sfxEmitter.emit('sfx:item-pick')
    useScene.temporal.getState().pause()
    const duplicate = WindowNode.parse({
      position: [...node.position] as [number, number, number],
      rotation: [...node.rotation] as [number, number, number],
      side: node.side,
      wallId: node.wallId,
      parentId: node.parentId,
      width: node.width,
      height: node.height,
      frameThickness: node.frameThickness,
      frameDepth: node.frameDepth,
      columnRatios: [...node.columnRatios],
      rowRatios: [...node.rowRatios],
      columnDividerThickness: node.columnDividerThickness,
      rowDividerThickness: node.rowDividerThickness,
      sill: node.sill,
      sillDepth: node.sillDepth,
      sillThickness: node.sillThickness,
      metadata: { isNew: true },
    })
    useScene.getState().createNode(duplicate, node.parentId as AnyNodeId)
    setMovingNode(duplicate)
    setSelection({ selectedIds: [] })
  }, [node, setMovingNode, setSelection])

  if (!node || node.type !== 'window' || selectedIds.length !== 1) return null

  const numCols = node.columnRatios.length
  const numRows = node.rowRatios.length

  const colSum = node.columnRatios.reduce((a, b) => a + b, 0)
  const rowSum = node.rowRatios.reduce((a, b) => a + b, 0)
  const normCols = node.columnRatios.map(r => r / colSum)
  const normRows = node.rowRatios.map(r => r / rowSum)

  const setColumnRatio = (index: number, newVal: number) => {
    const clamped = Math.max(0.05, Math.min(0.95, newVal))
    const neighborIdx = index < numCols - 1 ? index + 1 : index - 1
    const delta = clamped - normCols[index]!
    const neighborVal = Math.max(0.05, normCols[neighborIdx]! - delta)
    const newRatios = normCols.map((v, i) => {
      if (i === index) return clamped
      if (i === neighborIdx) return neighborVal
      return v
    })
    handleUpdate({ columnRatios: newRatios })
  }

  const setRowRatio = (index: number, newVal: number) => {
    const clamped = Math.max(0.05, Math.min(0.95, newVal))
    const neighborIdx = index < numRows - 1 ? index + 1 : index - 1
    const delta = clamped - normRows[index]!
    const neighborVal = Math.max(0.05, normRows[neighborIdx]! - delta)
    const newRatios = normRows.map((v, i) => {
      if (i === index) return clamped
      if (i === neighborIdx) return neighborVal
      return v
    })
    handleUpdate({ rowRatios: newRatios })
  }

  return (
    <PanelWrapper
      title={node.name || "Window"}
      icon="/icons/window.png"
      onClose={handleClose}
      width={320}
    >
      <PanelSection title="Position">
        <SliderControl
          label={<>X<sub className="text-[11px] ml-[1px] opacity-70">pos</sub></>}
          value={Math.round(node.position[0] * 100) / 100}
          onChange={(v) => handleUpdate({ position: [v, node.position[1], node.position[2]] })}
          min={-10}
          max={10}
          precision={2}
          step={0.1}
          unit="m"
        />
        <SliderControl
          label={<>Y<sub className="text-[11px] ml-[1px] opacity-70">pos</sub></>}
          value={Math.round(node.position[1] * 100) / 100}
          onChange={(v) => handleUpdate({ position: [node.position[0], v, node.position[2]] })}
          min={-10}
          max={10}
          precision={2}
          step={0.1}
          unit="m"
        />
        <div className="pt-2 pb-1 px-1">
          <ActionButton 
            icon={<FlipHorizontal2 className="h-4 w-4" />} 
            label="Flip Side" 
            onClick={handleFlip} 
            className="w-full"
          />
        </div>
      </PanelSection>

      <PanelSection title="Dimensions">
        <SliderControl
          label="Width"
          value={Math.round(node.width * 100) / 100}
          onChange={(v) => handleUpdate({ width: v })}
          min={0.2}
          max={5}
          precision={2}
          step={0.1}
          unit="m"
        />
        <SliderControl
          label="Height"
          value={Math.round(node.height * 100) / 100}
          onChange={(v) => handleUpdate({ height: v })}
          min={0.2}
          max={5}
          precision={2}
          step={0.1}
          unit="m"
        />
      </PanelSection>

      <PanelSection title="Frame">
        <SliderControl
          label="Thickness"
          value={Math.round(node.frameThickness * 1000) / 1000}
          onChange={(v) => handleUpdate({ frameThickness: v })}
          min={0.01}
          max={0.2}
          precision={3}
          step={0.01}
          unit="m"
        />
        <SliderControl
          label="Depth"
          value={Math.round(node.frameDepth * 1000) / 1000}
          onChange={(v) => handleUpdate({ frameDepth: v })}
          min={0.01}
          max={0.3}
          precision={3}
          step={0.01}
          unit="m"
        />
      </PanelSection>

      <PanelSection title="Grid">
        <SliderControl
          label="Columns"
          value={numCols}
          onChange={(v) => {
            const n = Math.max(1, Math.min(8, Math.round(v)))
            handleUpdate({ columnRatios: Array(n).fill(1 / n) })
          }}
          min={1}
          max={8}
          precision={0}
          step={1}
        />
        <SliderControl
          label="Rows"
          value={numRows}
          onChange={(v) => {
            const n = Math.max(1, Math.min(8, Math.round(v)))
            handleUpdate({ rowRatios: Array(n).fill(1 / n) })
          }}
          min={1}
          max={8}
          precision={0}
          step={1}
        />

        {numCols > 1 && (
          <div className="mt-2 flex flex-col gap-1">
            <div className="mb-1 px-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/80">Col Widths</div>
            {normCols.map((ratio, i) => (
              <SliderControl
                key={`c-${i}`}
                label={`C${i + 1}`}
                value={Math.round(ratio * 100 * 10) / 10}
                onChange={(v) => setColumnRatio(i, v / 100)}
                min={5}
                max={95}
                precision={1}
                step={1}
                unit="%"
              />
            ))}
                <div className="mt-1 border-t border-border/50 pt-1">
              <SliderControl
                label="Divider"
                value={Math.round((node.columnDividerThickness ?? 0.03) * 1000) / 1000}
                onChange={(v) => handleUpdate({ columnDividerThickness: v })}
                min={0.005}
                max={0.1}
                precision={3}
                step={0.01}
                unit="m"
              />
            </div>
          </div>
        )}

        {numRows > 1 && (
          <div className="mt-2 flex flex-col gap-1">
            <div className="mb-1 px-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/80">Row Heights</div>
            {normRows.map((ratio, i) => (
              <SliderControl
                key={`r-${i}`}
                label={`R${i + 1}`}
                value={Math.round(ratio * 100 * 10) / 10}
                onChange={(v) => setRowRatio(i, v / 100)}
                min={5}
                max={95}
                precision={1}
                step={1}
                unit="%"
              />
            ))}
                <div className="mt-1 border-t border-border/50 pt-1">
              <SliderControl
                label="Divider"
                value={Math.round((node.rowDividerThickness ?? 0.03) * 1000) / 1000}
                onChange={(v) => handleUpdate({ rowDividerThickness: v })}
                min={0.005}
                max={0.1}
                precision={3}
                step={0.01}
                unit="m"
              />
            </div>
          </div>
        )}
      </PanelSection>

      <PanelSection title="Sill">
        <ToggleControl
          label="Enable Sill"
          checked={node.sill}
          onChange={(checked) => handleUpdate({ sill: checked })}
        />
        {node.sill && (
          <div className="mt-1 flex flex-col gap-1">
            <SliderControl
              label="Depth"
              value={Math.round(node.sillDepth * 1000) / 1000}
              onChange={(v) => handleUpdate({ sillDepth: v })}
              min={0.01}
              max={0.5}
              precision={3}
              step={0.01}
              unit="m"
            />
            <SliderControl
              label="Thickness"
              value={Math.round(node.sillThickness * 1000) / 1000}
              onChange={(v) => handleUpdate({ sillThickness: v })}
              min={0.005}
              max={0.2}
              precision={3}
              step={0.01}
              unit="m"
            />
          </div>
        )}
      </PanelSection>

      <PanelSection title="Actions">
        <ActionGroup>
          <ActionButton icon={<Move className="h-3.5 w-3.5" />} label="Move" onClick={handleMove} />
          <ActionButton icon={<Copy className="h-3.5 w-3.5" />} label="Duplicate" onClick={handleDuplicate} />
          <ActionButton 
            icon={<Trash2 className="h-3.5 w-3.5 text-red-400" />} 
            label="Delete" 
            onClick={handleDelete} 
            className="hover:bg-red-500/20"
          />
        </ActionGroup>
      </PanelSection>
    </PanelWrapper>
  )
}

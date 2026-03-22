'use client'

import { type AnyNode, type AnyNodeId, emitter, useScene, WindowNode } from '@vesper/core'
import { useViewer } from '@vesper/viewer'
import { BookMarked, Copy, FlipHorizontal2, Move, Trash2 } from 'lucide-react'
import { useCallback } from 'react'
import { usePresetsAdapter } from '../../../contexts/presets-context'
import { sfxEmitter } from '../../../lib/sfx-bus'
import useEditor from '../../../store/use-editor'
import { ActionButton, ActionGroup } from '../controls/action-button'
import { MetricControl } from '../controls/metric-control'
import { PanelSection } from '../controls/panel-section'
import { SliderControl } from '../controls/slider-control'
import { ToggleControl } from '../controls/toggle-control'
import { PanelWrapper } from './panel-wrapper'
import { PresetsPopover } from './presets/presets-popover'

export function WindowPanel() {
  const selectedIds = useViewer((s) => s.selection.selectedIds)
  const setSelection = useViewer((s) => s.setSelection)
  const nodes = useScene((s) => s.nodes)
  const updateNode = useScene((s) => s.updateNode)
  const deleteNode = useScene((s) => s.deleteNode)
  const setMovingNode = useEditor((s) => s.setMovingNode)

  const adapter = usePresetsAdapter()

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
    if (!(selectedId && node)) return
    sfxEmitter.emit('sfx:item-delete')
    deleteNode(selectedId as AnyNode['id'])
    if (node.parentId) useScene.getState().dirtyNodes.add(node.parentId as AnyNodeId)
    setSelection({ selectedIds: [] })
  }, [selectedId, node, deleteNode, setSelection])

  const handleDuplicate = useCallback(() => {
    if (!(node && node.parentId)) return
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

  const getWindowPresetData = useCallback(() => {
    if (!node) return null
    return {
      width: node.width,
      height: node.height,
      frameThickness: node.frameThickness,
      frameDepth: node.frameDepth,
      columnRatios: node.columnRatios,
      rowRatios: node.rowRatios,
      columnDividerThickness: node.columnDividerThickness,
      rowDividerThickness: node.rowDividerThickness,
      sill: node.sill,
      sillDepth: node.sillDepth,
      sillThickness: node.sillThickness,
    }
  }, [node])

  const handleSavePreset = useCallback(
    async (name: string) => {
      const data = getWindowPresetData()
      if (!(data && selectedId)) return
      const presetId = await adapter.savePreset('window', name, data)
      if (presetId) emitter.emit('preset:generate-thumbnail', { presetId, nodeId: selectedId })
    },
    [getWindowPresetData, selectedId, adapter],
  )

  const handleOverwritePreset = useCallback(
    async (id: string) => {
      const data = getWindowPresetData()
      if (!(data && selectedId)) return
      await adapter.overwritePreset('window', id, data)
      emitter.emit('preset:generate-thumbnail', { presetId: id, nodeId: selectedId })
    },
    [getWindowPresetData, selectedId, adapter],
  )

  const handleApplyPreset = useCallback(
    (data: Record<string, unknown>) => {
      handleUpdate(data as Partial<WindowNode>)
    },
    [handleUpdate],
  )

  if (!node || node.type !== 'window' || selectedIds.length !== 1) return null

  const numCols = node.columnRatios.length
  const numRows = node.rowRatios.length

  const colSum = node.columnRatios.reduce((a, b) => a + b, 0)
  const rowSum = node.rowRatios.reduce((a, b) => a + b, 0)
  const normCols = node.columnRatios.map((r) => r / colSum)
  const normRows = node.rowRatios.map((r) => r / rowSum)

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
      icon="/icons/window.png"
      onClose={handleClose}
      title={node.name || 'Window'}
      width={320}
    >
      {/* Presets strip */}
      <div className="border-border/30 border-b px-3 pt-2.5 pb-1.5">
        <PresetsPopover
          isAuthenticated={adapter.isAuthenticated}
          onApply={handleApplyPreset}
          onDelete={(id) => adapter.deletePreset(id)}
          onFetchPresets={(tab) => adapter.fetchPresets('window', tab)}
          onOverwrite={handleOverwritePreset}
          onRename={(id, name) => adapter.renamePreset(id, name)}
          onSave={handleSavePreset}
          onToggleCommunity={adapter.togglePresetCommunity}
          tabs={adapter.tabs}
          type="window"
        >
          <button className="flex w-full items-center gap-2 rounded-lg border border-border/50 bg-[#2C2C2E] px-3 py-2 font-medium text-muted-foreground text-xs transition-colors hover:bg-[#3e3e3e] hover:text-foreground">
            <BookMarked className="h-3.5 w-3.5 shrink-0" />
            <span>Presets</span>
          </button>
        </PresetsPopover>
      </div>

      <PanelSection title="Position">
        <SliderControl
          label={
            <>
              X<sub className="ml-[1px] text-[11px] opacity-70">pos</sub>
            </>
          }
          max={10}
          min={-10}
          onChange={(v) => handleUpdate({ position: [v, node.position[1], node.position[2]] })}
          precision={2}
          step={0.1}
          unit="m"
          value={Math.round(node.position[0] * 100) / 100}
        />
        <SliderControl
          label={
            <>
              Y<sub className="ml-[1px] text-[11px] opacity-70">pos</sub>
            </>
          }
          max={10}
          min={-10}
          onChange={(v) => handleUpdate({ position: [node.position[0], v, node.position[2]] })}
          precision={2}
          step={0.1}
          unit="m"
          value={Math.round(node.position[1] * 100) / 100}
        />
        <div className="px-1 pt-2 pb-1">
          <ActionButton
            className="w-full"
            icon={<FlipHorizontal2 className="h-4 w-4" />}
            label="Flip Side"
            onClick={handleFlip}
          />
        </div>
      </PanelSection>

      <PanelSection title="Dimensions">
        <SliderControl
          label="Width"
          max={5}
          min={0.2}
          onChange={(v) => handleUpdate({ width: v })}
          precision={2}
          step={0.1}
          unit="m"
          value={Math.round(node.width * 100) / 100}
        />
        <SliderControl
          label="Height"
          max={5}
          min={0.2}
          onChange={(v) => handleUpdate({ height: v })}
          precision={2}
          step={0.1}
          unit="m"
          value={Math.round(node.height * 100) / 100}
        />
      </PanelSection>

      <PanelSection title="Frame">
        <SliderControl
          label="Thickness"
          max={0.2}
          min={0.01}
          onChange={(v) => handleUpdate({ frameThickness: v })}
          precision={3}
          step={0.01}
          unit="m"
          value={Math.round(node.frameThickness * 1000) / 1000}
        />
        <SliderControl
          label="Depth"
          max={0.3}
          min={0.01}
          onChange={(v) => handleUpdate({ frameDepth: v })}
          precision={3}
          step={0.01}
          unit="m"
          value={Math.round(node.frameDepth * 1000) / 1000}
        />
      </PanelSection>

      <PanelSection title="Grid">
        <SliderControl
          label="Columns"
          max={8}
          min={1}
          onChange={(v) => {
            const n = Math.max(1, Math.min(8, Math.round(v)))
            handleUpdate({ columnRatios: Array(n).fill(1 / n) })
          }}
          precision={0}
          step={1}
          value={numCols}
        />
        <SliderControl
          label="Rows"
          max={8}
          min={1}
          onChange={(v) => {
            const n = Math.max(1, Math.min(8, Math.round(v)))
            handleUpdate({ rowRatios: Array(n).fill(1 / n) })
          }}
          precision={0}
          step={1}
          value={numRows}
        />

        {numCols > 1 && (
          <div className="mt-2 flex flex-col gap-1">
            <div className="mb-1 px-1 font-medium text-[10px] text-muted-foreground/80 uppercase tracking-wider">
              Col Widths
            </div>
            {normCols.map((ratio, i) => (
              <SliderControl
                key={`c-${i}`}
                label={`C${i + 1}`}
                max={95}
                min={5}
                onChange={(v) => setColumnRatio(i, v / 100)}
                precision={1}
                step={1}
                unit="%"
                value={Math.round(ratio * 100 * 10) / 10}
              />
            ))}
            <div className="mt-1 border-border/50 border-t pt-1">
              <SliderControl
                label="Divider"
                max={0.1}
                min={0.005}
                onChange={(v) => handleUpdate({ columnDividerThickness: v })}
                precision={3}
                step={0.01}
                unit="m"
                value={Math.round((node.columnDividerThickness ?? 0.03) * 1000) / 1000}
              />
            </div>
          </div>
        )}

        {numRows > 1 && (
          <div className="mt-2 flex flex-col gap-1">
            <div className="mb-1 px-1 font-medium text-[10px] text-muted-foreground/80 uppercase tracking-wider">
              Row Heights
            </div>
            {normRows.map((ratio, i) => (
              <SliderControl
                key={`r-${i}`}
                label={`R${i + 1}`}
                max={95}
                min={5}
                onChange={(v) => setRowRatio(i, v / 100)}
                precision={1}
                step={1}
                unit="%"
                value={Math.round(ratio * 100 * 10) / 10}
              />
            ))}
            <div className="mt-1 border-border/50 border-t pt-1">
              <SliderControl
                label="Divider"
                max={0.1}
                min={0.005}
                onChange={(v) => handleUpdate({ rowDividerThickness: v })}
                precision={3}
                step={0.01}
                unit="m"
                value={Math.round((node.rowDividerThickness ?? 0.03) * 1000) / 1000}
              />
            </div>
          </div>
        )}
      </PanelSection>

      <PanelSection title="Sill">
        <ToggleControl
          checked={node.sill}
          label="Enable Sill"
          onChange={(checked) => handleUpdate({ sill: checked })}
        />
        {node.sill && (
          <div className="mt-1 flex flex-col gap-1">
            <SliderControl
              label="Depth"
              max={0.5}
              min={0.01}
              onChange={(v) => handleUpdate({ sillDepth: v })}
              precision={3}
              step={0.01}
              unit="m"
              value={Math.round(node.sillDepth * 1000) / 1000}
            />
            <SliderControl
              label="Thickness"
              max={0.2}
              min={0.005}
              onChange={(v) => handleUpdate({ sillThickness: v })}
              precision={3}
              step={0.01}
              unit="m"
              value={Math.round(node.sillThickness * 1000) / 1000}
            />
          </div>
        )}
      </PanelSection>

      <PanelSection title="Actions">
        <ActionGroup>
          <ActionButton icon={<Move className="h-3.5 w-3.5" />} label="Move" onClick={handleMove} />
          <ActionButton
            icon={<Copy className="h-3.5 w-3.5" />}
            label="Duplicate"
            onClick={handleDuplicate}
          />
          <ActionButton
            className="hover:bg-red-500/20"
            icon={<Trash2 className="h-3.5 w-3.5 text-red-400" />}
            label="Delete"
            onClick={handleDelete}
          />
        </ActionGroup>
      </PanelSection>
    </PanelWrapper>
  )
}

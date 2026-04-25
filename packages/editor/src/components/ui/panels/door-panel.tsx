'use client'

import {
  type AnyNode,
  type AnyNodeId,
  DoorNode,
  emitter,
  type MaterialSchema,
  useScene,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { BookMarked, Copy, FlipHorizontal2, Move, Trash2 } from 'lucide-react'
import { useCallback } from 'react'
import { usePresetsAdapter } from '../../../contexts/presets-context'
import { sfxEmitter } from '../../../lib/sfx-bus'
import useEditor from '../../../store/use-editor'
import { ActionButton, ActionGroup } from '../controls/action-button'
import { MaterialPicker } from '../controls/material-picker'
import { MetricControl } from '../controls/metric-control'
import { PanelSection } from '../controls/panel-section'
import { SegmentedControl } from '../controls/segmented-control'
import { SliderControl } from '../controls/slider-control'
import { ToggleControl } from '../controls/toggle-control'
import { PanelWrapper } from './panel-wrapper'
import { PresetsPopover } from './presets/presets-popover'

export function DoorPanel() {
  const selectedId = useViewer((s) => s.selection.selectedIds[0])
  const setSelection = useViewer((s) => s.setSelection)
  const updateNode = useScene((s) => s.updateNode)
  const deleteNode = useScene((s) => s.deleteNode)
  const setMovingNode = useEditor((s) => s.setMovingNode)

  const adapter = usePresetsAdapter()

  const node = useScene((s) =>
    selectedId ? (s.nodes[selectedId as AnyNode['id']] as DoorNode | undefined) : undefined,
  )

  const handleUpdate = useCallback(
    (updates: Partial<DoorNode>) => {
      if (!selectedId) return
      updateNode(selectedId as AnyNode['id'], updates)
      useScene.getState().dirtyNodes.add(selectedId as AnyNodeId)
    },
    [selectedId, updateNode],
  )

  const handleMaterialChange = useCallback(
    (material: MaterialSchema) => {
      handleUpdate({ material })
    },
    [handleUpdate],
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
    if (!node?.parentId) return
    sfxEmitter.emit('sfx:item-pick')
    useScene.temporal.getState().pause()
    const cloned = structuredClone(node) as any
    delete cloned.id
    cloned.metadata = { ...cloned.metadata, isNew: true }
    const duplicate = DoorNode.parse(cloned)
    useScene.getState().createNode(duplicate, node.parentId as AnyNodeId)
    setMovingNode(duplicate)
    setSelection({ selectedIds: [] })
  }, [node, setMovingNode, setSelection])

  const setSegmentHeightRatio = (segIdx: number, newVal: number) => {
    if (!node || node.segments.length < 2) return
    const numSegs = node.segments.length
    const totalH = node.segments.reduce((sum, s) => sum + s.heightRatio, 0)
    if (totalH <= 0) return
    const normH = node.segments.map((s) => s.heightRatio / totalH)
    const clamped = Math.max(0.05, Math.min(0.95, newVal))
    const neighborIdx = segIdx < numSegs - 1 ? segIdx + 1 : segIdx - 1
    const delta = clamped - normH[segIdx]!
    const neighborVal = Math.max(0.05, normH[neighborIdx]! - delta)
    const newRatios = normH.map((v, i) => {
      if (i === segIdx) return clamped
      if (i === neighborIdx) return neighborVal
      return v
    })
    const updated = node.segments.map((s, idx) => ({ ...s, heightRatio: newRatios[idx]! }))
    handleUpdate({ segments: updated })
  }

  const setSegmentColumnRatio = (segIdx: number, colIdx: number, newVal: number) => {
    const seg = node?.segments[segIdx]
    if (!seg) return
    const normRatios = (() => {
      const sum = seg.columnRatios.reduce((a, b) => a + b, 0)
      return seg.columnRatios.map((r) => r / sum)
    })()
    const numCols = normRatios.length
    const clamped = Math.max(0.05, Math.min(0.95, newVal))
    const neighborIdx = colIdx < numCols - 1 ? colIdx + 1 : colIdx - 1
    const delta = clamped - normRatios[colIdx]!
    const neighborVal = Math.max(0.05, normRatios[neighborIdx]! - delta)
    const newRatios = normRatios.map((v, i) => {
      if (i === colIdx) return clamped
      if (i === neighborIdx) return neighborVal
      return v
    })
    const updated = node?.segments.map((s, idx) =>
      idx === segIdx ? { ...s, columnRatios: newRatios } : s,
    )
    handleUpdate({ segments: updated })
  }

  const getDoorPresetData = useCallback(() => {
    if (!node) return null
    return {
      width: node.width,
      height: node.height,
      frameThickness: node.frameThickness,
      frameDepth: node.frameDepth,
      contentPadding: node.contentPadding,
      hingesSide: node.hingesSide,
      swingDirection: node.swingDirection,
      threshold: node.threshold,
      thresholdHeight: node.thresholdHeight,
      handle: node.handle,
      handleHeight: node.handleHeight,
      handleSide: node.handleSide,
      doorCloser: node.doorCloser,
      panicBar: node.panicBar,
      panicBarHeight: node.panicBarHeight,
      segments: node.segments,
    }
  }, [node])

  const handleSavePreset = useCallback(
    async (name: string) => {
      const data = getDoorPresetData()
      if (!(data && selectedId)) return
      const presetId = await adapter.savePreset('door', name, data)
      if (presetId) emitter.emit('preset:generate-thumbnail', { presetId, nodeId: selectedId })
    },
    [getDoorPresetData, selectedId, adapter],
  )

  const handleOverwritePreset = useCallback(
    async (id: string) => {
      const data = getDoorPresetData()
      if (!(data && selectedId)) return
      await adapter.overwritePreset('door', id, data)
      emitter.emit('preset:generate-thumbnail', { presetId: id, nodeId: selectedId })
    },
    [getDoorPresetData, selectedId, adapter],
  )

  const handleApplyPreset = useCallback(
    (data: Record<string, unknown>) => {
      handleUpdate(data as Partial<DoorNode>)
    },
    [handleUpdate],
  )

  if (!(node && node.type === 'door' && selectedId)) return null

  const hSum = node.segments.reduce((s, seg) => s + seg.heightRatio, 0)
  const normHeights = node.segments.map((seg) => seg.heightRatio / hSum)

  return (
    <PanelWrapper
      icon="/icons/door.png"
      onClose={handleClose}
      title={node.name || 'Door'}
      width={320}
    >
      {/* Presets strip */}
      <div className="border-border/30 border-b px-3 pt-2.5 pb-1.5">
        <PresetsPopover
          isAuthenticated={adapter.isAuthenticated}
          onApply={handleApplyPreset}
          onDelete={(id) => adapter.deletePreset(id)}
          onFetchPresets={(tab) => adapter.fetchPresets('door', tab)}
          onOverwrite={handleOverwritePreset}
          onRename={(id, name) => adapter.renamePreset(id, name)}
          onSave={handleSavePreset}
          onToggleCommunity={adapter.togglePresetCommunity}
          tabs={adapter.tabs}
          type="door"
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
              X<sub className="ml-[1px] text-[11px] opacity-70">wall</sub>
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
          max={3}
          min={0.5}
          onChange={(v) => handleUpdate({ width: v })}
          precision={2}
          step={0.05}
          unit="m"
          value={Math.round(node.width * 100) / 100}
        />
        <SliderControl
          label="Height"
          max={4}
          min={1.0}
          onChange={(v) =>
            handleUpdate({ height: v, position: [node.position[0], v / 2, node.position[2]] })
          }
          precision={2}
          step={0.05}
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

      <PanelSection title="Content Padding">
        <SliderControl
          label="Horizontal"
          max={0.2}
          min={0}
          onChange={(v) => handleUpdate({ contentPadding: [v, node.contentPadding[1]] })}
          precision={3}
          step={0.005}
          unit="m"
          value={Math.round(node.contentPadding[0] * 1000) / 1000}
        />
        <SliderControl
          label="Vertical"
          max={0.2}
          min={0}
          onChange={(v) => handleUpdate({ contentPadding: [node.contentPadding[0], v] })}
          precision={3}
          step={0.005}
          unit="m"
          value={Math.round(node.contentPadding[1] * 1000) / 1000}
        />
      </PanelSection>

      <PanelSection title="Swing">
        <div className="flex flex-col gap-2 px-1 pb-1">
          <div className="space-y-1">
            <span className="font-medium text-[10px] text-muted-foreground/80 uppercase tracking-wider">
              Hinges Side
            </span>
            <SegmentedControl
              onChange={(v) => handleUpdate({ hingesSide: v })}
              options={[
                { label: 'Left', value: 'left' },
                { label: 'Right', value: 'right' },
              ]}
              value={node.hingesSide}
            />
          </div>
          <div className="space-y-1">
            <span className="font-medium text-[10px] text-muted-foreground/80 uppercase tracking-wider">
              Direction
            </span>
            <SegmentedControl
              onChange={(v) => handleUpdate({ swingDirection: v })}
              options={[
                { label: 'Inward', value: 'inward' },
                { label: 'Outward', value: 'outward' },
              ]}
              value={node.swingDirection}
            />
          </div>
        </div>
      </PanelSection>

      <PanelSection title="Threshold">
        <ToggleControl
          checked={node.threshold}
          label="Enable Threshold"
          onChange={(checked) => handleUpdate({ threshold: checked })}
        />
        {node.threshold && (
          <div className="mt-1 flex flex-col gap-1">
            <SliderControl
              label="Height"
              max={0.1}
              min={0.005}
              onChange={(v) => handleUpdate({ thresholdHeight: v })}
              precision={3}
              step={0.005}
              unit="m"
              value={Math.round(node.thresholdHeight * 1000) / 1000}
            />
          </div>
        )}
      </PanelSection>

      <PanelSection title="Handle">
        <ToggleControl
          checked={node.handle}
          label="Enable Handle"
          onChange={(checked) => handleUpdate({ handle: checked })}
        />
        {node.handle && (
          <div className="mt-1 flex flex-col gap-1">
            <SliderControl
              label="Height"
              max={node.height - 0.1}
              min={0.5}
              onChange={(v) => handleUpdate({ handleHeight: v })}
              precision={2}
              step={0.05}
              unit="m"
              value={Math.round(node.handleHeight * 100) / 100}
            />
            <div className="space-y-1">
              <span className="font-medium text-[10px] text-muted-foreground/80 uppercase tracking-wider">
                Handle Side
              </span>
              <SegmentedControl
                onChange={(v) => handleUpdate({ handleSide: v })}
                options={[
                  { label: 'Left', value: 'left' },
                  { label: 'Right', value: 'right' },
                ]}
                value={node.handleSide}
              />
            </div>
          </div>
        )}
      </PanelSection>

      <PanelSection title="Hardware">
        <ToggleControl
          checked={node.doorCloser}
          label="Door Closer"
          onChange={(checked) => handleUpdate({ doorCloser: checked })}
        />
        <ToggleControl
          checked={node.panicBar}
          label="Panic Bar"
          onChange={(checked) => handleUpdate({ panicBar: checked })}
        />
        {node.panicBar && (
          <div className="mt-1 flex flex-col gap-1">
            <SliderControl
              label="Bar Height"
              max={node.height - 0.1}
              min={0.5}
              onChange={(v) => handleUpdate({ panicBarHeight: v })}
              precision={2}
              step={0.05}
              unit="m"
              value={Math.round(node.panicBarHeight * 100) / 100}
            />
          </div>
        )}
      </PanelSection>

      <PanelSection title="Segments">
        {node.segments.map((seg, i) => {
          const numCols = seg.columnRatios.length
          const colSum = seg.columnRatios.reduce((a, b) => a + b, 0)
          const normCols = seg.columnRatios.map((r) => r / colSum)
          return (
            <div className="mb-2 flex flex-col gap-1" key={i}>
              <div className="flex items-center justify-between pb-1">
                <span className="font-medium text-white/80 text-xs">Segment {i + 1}</span>
              </div>

              <SegmentedControl
                onChange={(t) => {
                  const updated = node.segments.map((s, idx) => (idx === i ? { ...s, type: t } : s))
                  handleUpdate({ segments: updated })
                }}
                options={[
                  { label: 'Panel', value: 'panel' },
                  { label: 'Glass', value: 'glass' },
                  { label: 'Empty', value: 'empty' },
                ]}
                value={seg.type}
              />

              <SliderControl
                label="Height"
                max={95}
                min={5}
                onChange={(v) => setSegmentHeightRatio(i, v / 100)}
                precision={1}
                step={1}
                unit="%"
                value={Math.round(normHeights[i]! * 100 * 10) / 10}
              />

              <SliderControl
                label="Columns"
                max={8}
                min={1}
                onChange={(v) => {
                  const n = Math.max(1, Math.min(8, Math.round(v)))
                  const updated = node.segments.map((s, idx) =>
                    idx === i ? { ...s, columnRatios: Array(n).fill(1 / n) } : s,
                  )
                  handleUpdate({ segments: updated })
                }}
                precision={0}
                step={1}
                value={numCols}
              />

              {numCols > 1 && (
                <div className="mt-1 border-border/50 border-t pt-1">
                  {normCols.map((ratio, ci) => (
                    <SliderControl
                      key={`c-${ci}`}
                      label={`C${ci + 1}`}
                      max={95}
                      min={5}
                      onChange={(v) => setSegmentColumnRatio(i, ci, v / 100)}
                      precision={1}
                      step={1}
                      unit="%"
                      value={Math.round(ratio * 100 * 10) / 10}
                    />
                  ))}
                  <SliderControl
                    label="Divider"
                    max={0.1}
                    min={0.005}
                    onChange={(v) => {
                      const updated = node.segments.map((s, idx) =>
                        idx === i ? { ...s, dividerThickness: v } : s,
                      )
                      handleUpdate({ segments: updated })
                    }}
                    precision={3}
                    step={0.005}
                    unit="m"
                    value={Math.round(seg.dividerThickness * 1000) / 1000}
                  />
                </div>
              )}

              {seg.type === 'panel' && (
                <div className="mt-1 border-border/50 border-t pt-1">
                  <SliderControl
                    label="Inset"
                    max={0.1}
                    min={0}
                    onChange={(v) => {
                      const updated = node.segments.map((s, idx) =>
                        idx === i ? { ...s, panelInset: v } : s,
                      )
                      handleUpdate({ segments: updated })
                    }}
                    precision={3}
                    step={0.005}
                    unit="m"
                    value={Math.round(seg.panelInset * 1000) / 1000}
                  />
                  <SliderControl
                    label="Depth"
                    max={0.1}
                    min={0}
                    onChange={(v) => {
                      const updated = node.segments.map((s, idx) =>
                        idx === i ? { ...s, panelDepth: v } : s,
                      )
                      handleUpdate({ segments: updated })
                    }}
                    precision={3}
                    step={0.005}
                    unit="m"
                    value={Math.round(seg.panelDepth * 1000) / 1000}
                  />
                </div>
              )}
            </div>
          )
        })}

        <div className="flex gap-1.5 px-1 pt-1">
          <ActionButton
            label="+ Add Segment"
            onClick={() => {
              const updated = [
                ...node.segments,
                {
                  type: 'panel' as const,
                  heightRatio: 1,
                  columnRatios: [1],
                  dividerThickness: 0.03,
                  panelDepth: 0.01,
                  panelInset: 0.04,
                },
              ]
              handleUpdate({ segments: updated })
            }}
          />
          {node.segments.length > 1 && (
            <ActionButton
              className="text-white/60 hover:text-white"
              label="- Remove"
              onClick={() => handleUpdate({ segments: node.segments.slice(0, -1) })}
            />
          )}
        </div>
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
      <PanelSection title="Material">
        <MaterialPicker onChange={handleMaterialChange} value={node.material} />
      </PanelSection>
    </PanelWrapper>
  )
}

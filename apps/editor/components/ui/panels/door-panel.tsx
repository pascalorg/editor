'use client'

import { type AnyNode, type AnyNodeId, DoorNode, useScene } from '@pascal-app/core'
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
import { SegmentedControl } from '../controls/segmented-control'
import { ActionButton, ActionGroup } from '../controls/action-button'

export function DoorPanel() {
  const selectedIds = useViewer((s) => s.selection.selectedIds)
  const setSelection = useViewer((s) => s.setSelection)
  const nodes = useScene((s) => s.nodes)
  const updateNode = useScene((s) => s.updateNode)
  const deleteNode = useScene((s) => s.deleteNode)
  const setMovingNode = useEditor((s) => s.setMovingNode)

  const selectedId = selectedIds[0]
  const node = selectedId
    ? (nodes[selectedId as AnyNode['id']] as DoorNode | undefined)
    : undefined

  const handleUpdate = useCallback(
    (updates: Partial<DoorNode>) => {
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
    const duplicate = DoorNode.parse({
      position: [...node.position] as [number, number, number],
      rotation: [...node.rotation] as [number, number, number],
      side: node.side,
      wallId: node.wallId,
      parentId: node.parentId,
      width: node.width,
      height: node.height,
      frameThickness: node.frameThickness,
      frameDepth: node.frameDepth,
      threshold: node.threshold,
      thresholdHeight: node.thresholdHeight,
      hingesSide: node.hingesSide,
      swingDirection: node.swingDirection,
      segments: node.segments.map(s => ({ ...s, columnRatios: [...s.columnRatios] })),
      handle: node.handle,
      handleHeight: node.handleHeight,
      handleSide: node.handleSide,
      doorCloser: node.doorCloser,
      panicBar: node.panicBar,
      panicBarHeight: node.panicBarHeight,
      metadata: { isNew: true },
    })
    useScene.getState().createNode(duplicate, node.parentId as AnyNodeId)
    setMovingNode(duplicate)
    setSelection({ selectedIds: [] })
  }, [node, setMovingNode, setSelection])

  const setSegmentHeightRatio = (segIdx: number, newVal: number) => {
    const numSegs = node!.segments.length
    const totalH = node!.segments.reduce((sum, s) => sum + s.heightRatio, 0)
    const normH = node!.segments.map(s => s.heightRatio / totalH)
    const clamped = Math.max(0.05, Math.min(0.95, newVal))
    const neighborIdx = segIdx < numSegs - 1 ? segIdx + 1 : segIdx - 1
    const delta = clamped - normH[segIdx]!
    const neighborVal = Math.max(0.05, normH[neighborIdx]! - delta)
    const newRatios = normH.map((v, i) => {
      if (i === segIdx) return clamped
      if (i === neighborIdx) return neighborVal
      return v
    })
    const updated = node!.segments.map((s, idx) => ({ ...s, heightRatio: newRatios[idx]! }))
    handleUpdate({ segments: updated })
  }

  const setSegmentColumnRatio = (segIdx: number, colIdx: number, newVal: number) => {
    const seg = node!.segments[segIdx]!
    const normRatios = (() => {
      const sum = seg.columnRatios.reduce((a, b) => a + b, 0)
      return seg.columnRatios.map(r => r / sum)
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
    const updated = node!.segments.map((s, idx) =>
      idx === segIdx ? { ...s, columnRatios: newRatios } : s,
    )
    handleUpdate({ segments: updated })
  }

  if (!node || node.type !== 'door' || selectedIds.length !== 1) return null

  const hSum = node.segments.reduce((s, seg) => s + seg.heightRatio, 0)
  const normHeights = node.segments.map(seg => seg.heightRatio / hSum)

  return (
    <PanelWrapper
      title={node.name || "Door"}
      icon="/icons/door.png"
      onClose={handleClose}
      width={320}
    >
      <PanelSection title="Position">
        <SliderControl
          label={<>X<sub className="text-[11px] ml-[1px] opacity-70">wall</sub></>}
          value={Math.round(node.position[0] * 100) / 100}
          onChange={(v) => handleUpdate({ position: [v, node.position[1], node.position[2]] })}
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
          min={0.5}
          max={3}
          precision={2}
          step={0.05}
          unit="m"
        />
        <SliderControl
          label="Height"
          value={Math.round(node.height * 100) / 100}
          onChange={(v) => handleUpdate({ height: v, position: [node.position[0], v / 2, node.position[2]] })}
          min={1.0}
          max={4}
          precision={2}
          step={0.05}
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

      <PanelSection title="Content Padding">
        <SliderControl
          label="Horizontal"
          value={Math.round(node.contentPadding[0] * 1000) / 1000}
          onChange={(v) => handleUpdate({ contentPadding: [v, node.contentPadding[1]] })}
          min={0}
          max={0.2}
          precision={3}
          step={0.005}
          unit="m"
        />
        <SliderControl
          label="Vertical"
          value={Math.round(node.contentPadding[1] * 1000) / 1000}
          onChange={(v) => handleUpdate({ contentPadding: [node.contentPadding[0], v] })}
          min={0}
          max={0.2}
          precision={3}
          step={0.005}
          unit="m"
        />
      </PanelSection>

      <PanelSection title="Swing">
        <div className="flex flex-col gap-2 px-1 pb-1">
          <div className="space-y-1">
            <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/80">Hinges Side</span>
            <SegmentedControl
              value={node.hingesSide}
              onChange={(v) => handleUpdate({ hingesSide: v })}
              options={[
                { label: 'Left', value: 'left' },
                { label: 'Right', value: 'right' },
              ]}
            />
          </div>
          <div className="space-y-1">
            <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/80">Direction</span>
            <SegmentedControl
              value={node.swingDirection}
              onChange={(v) => handleUpdate({ swingDirection: v })}
              options={[
                { label: 'Inward', value: 'inward' },
                { label: 'Outward', value: 'outward' },
              ]}
            />
          </div>
        </div>
      </PanelSection>

      <PanelSection title="Threshold">
        <ToggleControl
          label="Enable Threshold"
          checked={node.threshold}
          onChange={(checked) => handleUpdate({ threshold: checked })}
        />
        {node.threshold && (
          <div className="mt-1 flex flex-col gap-1">
            <SliderControl
              label="Height"
              value={Math.round(node.thresholdHeight * 1000) / 1000}
              onChange={(v) => handleUpdate({ thresholdHeight: v })}
              min={0.005}
              max={0.1}
              precision={3}
              step={0.005}
              unit="m"
            />
          </div>
        )}
      </PanelSection>

      <PanelSection title="Handle">
        <ToggleControl
          label="Enable Handle"
          checked={node.handle}
          onChange={(checked) => handleUpdate({ handle: checked })}
        />
        {node.handle && (
          <div className="mt-1 flex flex-col gap-1">
            <SliderControl
              label="Height"
              value={Math.round(node.handleHeight * 100) / 100}
              onChange={(v) => handleUpdate({ handleHeight: v })}
              min={0.5}
              max={node.height - 0.1}
              precision={2}
              step={0.05}
              unit="m"
            />
            <div className="space-y-1">
              <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/80">Handle Side</span>
              <SegmentedControl
                value={node.handleSide}
                onChange={(v) => handleUpdate({ handleSide: v })}
                options={[
                  { label: 'Left', value: 'left' },
                  { label: 'Right', value: 'right' },
                ]}
              />
            </div>
          </div>
        )}
      </PanelSection>

      <PanelSection title="Hardware">
        <ToggleControl
          label="Door Closer"
          checked={node.doorCloser}
          onChange={(checked) => handleUpdate({ doorCloser: checked })}
        />
        <ToggleControl
          label="Panic Bar"
          checked={node.panicBar}
          onChange={(checked) => handleUpdate({ panicBar: checked })}
        />
        {node.panicBar && (
          <div className="mt-1 flex flex-col gap-1">
            <SliderControl
              label="Bar Height"
              value={Math.round(node.panicBarHeight * 100) / 100}
              onChange={(v) => handleUpdate({ panicBarHeight: v })}
              min={0.5}
              max={node.height - 0.1}
              precision={2}
              step={0.05}
              unit="m"
            />
          </div>
        )}
      </PanelSection>

      <PanelSection title="Segments">
        {node.segments.map((seg, i) => {
          const numCols = seg.columnRatios.length
          const colSum = seg.columnRatios.reduce((a, b) => a + b, 0)
          const normCols = seg.columnRatios.map(r => r / colSum)
          return (
            <div key={i} className="mb-2 flex flex-col gap-1">
              <div className="flex items-center justify-between pb-1">
                <span className="text-xs font-medium text-white/80">Segment {i + 1}</span>
              </div>
              
              <SegmentedControl
                value={seg.type}
                onChange={(t) => {
                  const updated = node.segments.map((s, idx) => idx === i ? { ...s, type: t } : s)
                  handleUpdate({ segments: updated })
                }}
                options={[
                  { label: 'Panel', value: 'panel' },
                  { label: 'Glass', value: 'glass' },
                  { label: 'Empty', value: 'empty' },
                ]}
              />

              <SliderControl
                label="Height"
                value={Math.round(normHeights[i]! * 100 * 10) / 10}
                onChange={(v) => setSegmentHeightRatio(i, v / 100)}
                min={5}
                max={95}
                precision={1}
                step={1}
                unit="%"
              />

              <SliderControl
                label="Columns"
                value={numCols}
                onChange={(v) => {
                  const n = Math.max(1, Math.min(8, Math.round(v)))
                  const updated = node.segments.map((s, idx) =>
                    idx === i ? { ...s, columnRatios: Array(n).fill(1 / n) } : s,
                  )
                  handleUpdate({ segments: updated })
                }}
                min={1}
                max={8}
                precision={0}
                step={1}
              />

              {numCols > 1 && (
                <div className="mt-1 border-t border-border/50 pt-1">
                  {normCols.map((ratio, ci) => (
                    <SliderControl
                      key={`c-${ci}`}
                      label={`C${ci + 1}`}
                      value={Math.round(ratio * 100 * 10) / 10}
                      onChange={(v) => setSegmentColumnRatio(i, ci, v / 100)}
                      min={5}
                      max={95}
                      precision={1}
                      step={1}
                      unit="%"
                    />
                  ))}
                  <SliderControl
                    label="Divider"
                    value={Math.round(seg.dividerThickness * 1000) / 1000}
                    onChange={(v) => {
                      const updated = node.segments.map((s, idx) =>
                        idx === i ? { ...s, dividerThickness: v } : s,
                      )
                      handleUpdate({ segments: updated })
                    }}
                    min={0.005}
                    max={0.1}
                    precision={3}
                    step={0.005}
                    unit="m"
                  />
                </div>
              )}

              {seg.type === 'panel' && (
                <div className="mt-1 border-t border-border/50 pt-1">
                  <SliderControl
                    label="Inset"
                    value={Math.round(seg.panelInset * 1000) / 1000}
                    onChange={(v) => {
                      const updated = node.segments.map((s, idx) =>
                        idx === i ? { ...s, panelInset: v } : s,
                      )
                      handleUpdate({ segments: updated })
                    }}
                    min={0}
                    max={0.1}
                    precision={3}
                    step={0.005}
                    unit="m"
                  />
                  <SliderControl
                    label="Depth"
                    value={Math.round(seg.panelDepth * 1000) / 1000}
                    onChange={(v) => {
                      const updated = node.segments.map((s, idx) =>
                        idx === i ? { ...s, panelDepth: v } : s,
                      )
                      handleUpdate({ segments: updated })
                    }}
                    min={0}
                    max={0.1}
                    precision={3}
                    step={0.005}
                    unit="m"
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
                { type: 'panel' as const, heightRatio: 1, columnRatios: [1], dividerThickness: 0.03, panelDepth: 0.01, panelInset: 0.04 },
              ]
              handleUpdate({ segments: updated })
            }}
          />
          {node.segments.length > 1 && (
            <ActionButton 
              label="- Remove" 
              onClick={() => handleUpdate({ segments: node.segments.slice(0, -1) })}
              className="text-white/60 hover:text-white"
            />
          )}
        </div>
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

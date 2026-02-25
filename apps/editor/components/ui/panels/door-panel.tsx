'use client'

import { type AnyNode, type AnyNodeId, DoorNode, useScene } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { Copy, FlipHorizontal2, Move, Trash2, X } from 'lucide-react'
import Image from 'next/image'
import { useCallback } from 'react'
import { sfxEmitter } from '@/lib/sfx-bus'
import useEditor from '@/store/use-editor'
import { NumberInput } from '@/components/ui/primitives/number-input'
import { Switch } from '@/components/ui/primitives/switch'

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

  if (!node || node.type !== 'door' || selectedIds.length !== 1) return null

  return (
    <div className="pointer-events-auto fixed top-20 right-4 z-50 flex w-82 flex-col overflow-hidden rounded-lg border border-border bg-background/95 shadow-xl backdrop-blur-md">
      {/* Header */}
      <div className="flex items-center justify-between gap-2 border-b p-3">
        <div className="flex items-center gap-2 min-w-0">
          <Image src="/icons/door.png" alt="" width={16} height={16} className="shrink-0 object-contain" />
          <h2 className="font-semibold text-foreground text-sm truncate">
            {node.name || `Door (${node.width}×${node.height}m)`}
          </h2>
        </div>
        <button
          type="button"
          className="shrink-0 rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground cursor-pointer"
          onClick={handleClose}
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-3 space-y-4">

        {/* Position */}
        <div className="space-y-2">
          <label className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
            Position
          </label>
          <div className="grid grid-cols-1 gap-2">
            <NumberInput
              label="X along wall"
              value={Math.round(node.position[0] * 100) / 100}
              onChange={(v) => handleUpdate({ position: [v, node.position[1], node.position[2]] })}
              precision={2}
            />
          </div>
          <button
            type="button"
            className="w-full flex items-center justify-center gap-1.5 rounded border border-border px-2 py-1.5 text-xs hover:bg-accent cursor-pointer"
            onClick={handleFlip}
          >
            <FlipHorizontal2 className="h-3.5 w-3.5" />
            Flip Side
          </button>
        </div>

        {/* Dimensions */}
        <div className="space-y-2">
          <label className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
            Dimensions
          </label>
          <div className="grid grid-cols-2 gap-2">
            <div className="flex items-center gap-1.5">
              <NumberInput
                label="Width"
                value={Math.round(node.width * 100) / 100}
                onChange={(v) => handleUpdate({ width: v })}
                min={0.5}
                precision={2}
                className="flex-1"
              />
              <span className="text-muted-foreground text-xs shrink-0">m</span>
            </div>
            <div className="flex items-center gap-1.5">
              <NumberInput
                label="Height"
                value={Math.round(node.height * 100) / 100}
                onChange={(v) => handleUpdate({ height: v })}
                min={1.0}
                precision={2}
                className="flex-1"
              />
              <span className="text-muted-foreground text-xs shrink-0">m</span>
            </div>
          </div>
        </div>

        {/* Frame */}
        <div className="space-y-2">
          <label className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
            Frame
          </label>
          <div className="grid grid-cols-2 gap-2">
            <div className="flex items-center gap-1.5">
              <NumberInput
                label="Thickness"
                value={Math.round(node.frameThickness * 1000) / 1000}
                onChange={(v) => handleUpdate({ frameThickness: v })}
                min={0.01}
                precision={3}
                step={0.01}
                className="flex-1"
              />
              <span className="text-muted-foreground text-xs shrink-0">m</span>
            </div>
            <div className="flex items-center gap-1.5">
              <NumberInput
                label="Depth"
                value={Math.round(node.frameDepth * 1000) / 1000}
                onChange={(v) => handleUpdate({ frameDepth: v })}
                min={0.01}
                precision={3}
                step={0.01}
                className="flex-1"
              />
              <span className="text-muted-foreground text-xs shrink-0">m</span>
            </div>
          </div>
        </div>

        {/* Swing */}
        <div className="space-y-2">
          <label className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
            Swing
          </label>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <span className="text-xs text-muted-foreground">Hinges</span>
              <div className="flex gap-1">
                {(['left', 'right'] as const).map((side) => (
                  <button
                    key={side}
                    type="button"
                    onClick={() => handleUpdate({ hingesSide: side })}
                    className={`flex-1 rounded border px-2 py-1 text-xs cursor-pointer transition-colors ${
                      node.hingesSide === side
                        ? 'border-primary bg-primary text-primary-foreground'
                        : 'border-border hover:bg-accent'
                    }`}
                  >
                    {side.charAt(0).toUpperCase() + side.slice(1)}
                  </button>
                ))}
              </div>
            </div>
            <div className="space-y-1">
              <span className="text-xs text-muted-foreground">Direction</span>
              <div className="flex gap-1">
                {(['inward', 'outward'] as const).map((dir) => (
                  <button
                    key={dir}
                    type="button"
                    onClick={() => handleUpdate({ swingDirection: dir })}
                    className={`flex-1 rounded border px-2 py-1 text-xs cursor-pointer transition-colors ${
                      node.swingDirection === dir
                        ? 'border-primary bg-primary text-primary-foreground'
                        : 'border-border hover:bg-accent'
                    }`}
                  >
                    {dir.charAt(0).toUpperCase() + dir.slice(1)}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Threshold */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
              Threshold
            </label>
            <Switch
              checked={node.threshold}
              onCheckedChange={(checked) => handleUpdate({ threshold: checked })}
            />
          </div>
          {node.threshold && (
            <div className="flex items-center gap-1.5">
              <NumberInput
                label="Height"
                value={Math.round(node.thresholdHeight * 1000) / 1000}
                onChange={(v) => handleUpdate({ thresholdHeight: v })}
                min={0.005}
                precision={3}
                step={0.005}
                className="flex-1"
              />
              <span className="text-muted-foreground text-xs shrink-0">m</span>
            </div>
          )}
        </div>

        {/* Handle */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
              Handle
            </label>
            <Switch
              checked={node.handle}
              onCheckedChange={(checked) => handleUpdate({ handle: checked })}
            />
          </div>
          {node.handle && (
            <div className="grid grid-cols-2 gap-2">
              <div className="flex items-center gap-1.5">
                <NumberInput
                  label="Height"
                  value={Math.round(node.handleHeight * 100) / 100}
                  onChange={(v) => handleUpdate({ handleHeight: v })}
                  min={0.5}
                  max={node.height - 0.1}
                  precision={2}
                  step={0.05}
                  className="flex-1"
                />
                <span className="text-muted-foreground text-xs shrink-0">m</span>
              </div>
              <div className="space-y-1">
                <span className="text-xs text-muted-foreground">Side</span>
                <div className="flex gap-1">
                  {(['left', 'right'] as const).map((side) => (
                    <button
                      key={side}
                      type="button"
                      onClick={() => handleUpdate({ handleSide: side })}
                      className={`flex-1 rounded border px-2 py-1 text-xs cursor-pointer transition-colors ${
                        node.handleSide === side
                          ? 'border-primary bg-primary text-primary-foreground'
                          : 'border-border hover:bg-accent'
                      }`}
                    >
                      {side.charAt(0).toUpperCase() + side.slice(1)}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Hardware */}
        <div className="space-y-2">
          <label className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
            Hardware
          </label>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm text-foreground">Door Closer</span>
              <Switch
                checked={node.doorCloser}
                onCheckedChange={(checked) => handleUpdate({ doorCloser: checked })}
              />
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-foreground">Panic Bar</span>
              <Switch
                checked={node.panicBar}
                onCheckedChange={(checked) => handleUpdate({ panicBar: checked })}
              />
            </div>
            {node.panicBar && (
              <div className="flex items-center gap-1.5">
                <NumberInput
                  label="Bar height"
                  value={Math.round(node.panicBarHeight * 100) / 100}
                  onChange={(v) => handleUpdate({ panicBarHeight: v })}
                  min={0.5}
                  max={node.height - 0.1}
                  precision={2}
                  step={0.05}
                  className="flex-1"
                />
                <span className="text-muted-foreground text-xs shrink-0">m</span>
              </div>
            )}
          </div>
        </div>

        {/* Segments */}
        <div className="space-y-2">
          <label className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
            Leaf segments (top → bottom)
          </label>
          {node.segments.map((seg, i) => (
            <div key={i} className="rounded border border-border p-2 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs text-muted-foreground">Segment {i + 1}</span>
                <div className="flex gap-1">
                  {(['panel', 'glass', 'empty'] as const).map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => {
                        const updated = node.segments.map((s, idx) =>
                          idx === i ? { ...s, type: t } : s,
                        )
                        handleUpdate({ segments: updated })
                      }}
                      className={`rounded border px-1.5 py-0.5 text-xs cursor-pointer transition-colors ${
                        seg.type === t
                          ? 'border-primary bg-primary text-primary-foreground'
                          : 'border-border hover:bg-accent'
                      }`}
                    >
                      {t}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex items-center gap-1.5">
                <NumberInput
                  label="Height ratio"
                  value={Math.round(seg.heightRatio * 100) / 100}
                  onChange={(v) => {
                    const updated = node.segments.map((s, idx) =>
                      idx === i ? { ...s, heightRatio: Math.max(0.05, v) } : s,
                    )
                    handleUpdate({ segments: updated })
                  }}
                  min={0.05}
                  precision={2}
                  step={0.05}
                  className="flex-1"
                />
              </div>
              {seg.type === 'panel' && (
                <div className="grid grid-cols-2 gap-2">
                  <div className="flex items-center gap-1.5">
                    <NumberInput
                      label="Inset"
                      value={Math.round(seg.panelInset * 1000) / 1000}
                      onChange={(v) => {
                        const updated = node.segments.map((s, idx) =>
                          idx === i ? { ...s, panelInset: v } : s,
                        )
                        handleUpdate({ segments: updated })
                      }}
                      min={0.005}
                      precision={3}
                      step={0.005}
                      className="flex-1"
                    />
                    <span className="text-muted-foreground text-xs shrink-0">m</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <NumberInput
                      label="Depth"
                      value={Math.round(seg.panelDepth * 1000) / 1000}
                      onChange={(v) => {
                        const updated = node.segments.map((s, idx) =>
                          idx === i ? { ...s, panelDepth: v } : s,
                        )
                        handleUpdate({ segments: updated })
                      }}
                      precision={3}
                      step={0.005}
                      className="flex-1"
                    />
                    <span className="text-muted-foreground text-xs shrink-0">m</span>
                  </div>
                </div>
              )}
            </div>
          ))}
          <div className="flex gap-2">
            <button
              type="button"
              className="flex-1 rounded border border-border px-2 py-1 text-xs hover:bg-accent cursor-pointer"
              onClick={() => {
                const updated = [
                  ...node.segments,
                  { type: 'panel' as const, heightRatio: 1, columnRatios: [1], dividerThickness: 0.03, panelDepth: 0.01, panelInset: 0.04 },
                ]
                handleUpdate({ segments: updated })
              }}
            >
              + Add segment
            </button>
            {node.segments.length > 1 && (
              <button
                type="button"
                className="flex-1 rounded border border-border px-2 py-1 text-xs hover:bg-accent cursor-pointer"
                onClick={() => {
                  handleUpdate({ segments: node.segments.slice(0, -1) })
                }}
              >
                − Remove last
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Action Buttons */}
      <div className="border-t p-3">
        <div className="flex gap-2">
          <button
            type="button"
            className="flex-1 flex items-center justify-center gap-1.5 rounded border border-border px-2 py-1.5 text-xs hover:bg-accent cursor-pointer"
            onClick={handleMove}
          >
            <Move className="h-3.5 w-3.5" />
            <span>Move</span>
          </button>
          <button
            type="button"
            className="flex-1 flex items-center justify-center gap-1.5 rounded border border-border px-2 py-1.5 text-xs hover:bg-accent cursor-pointer"
            onClick={handleDuplicate}
          >
            <Copy className="h-3.5 w-3.5" />
            <span>Duplicate</span>
          </button>
          <button
            type="button"
            className="flex-1 flex items-center justify-center gap-1.5 rounded border border-border px-2 py-1.5 text-xs hover:bg-accent cursor-pointer"
            onClick={handleDelete}
          >
            <Trash2 className="h-3.5 w-3.5" />
            <span>Delete</span>
          </button>
        </div>
      </div>
    </div>
  )
}

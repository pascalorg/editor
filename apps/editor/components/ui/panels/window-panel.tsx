'use client'

import { type AnyNode, type AnyNodeId, type WindowNode, useScene } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { FlipHorizontal2, X } from 'lucide-react'
import Image from 'next/image'
import { useCallback } from 'react'
import { NumberInput } from '@/components/ui/primitives/number-input'
import { Switch } from '@/components/ui/primitives/switch'

export function WindowPanel() {
  const selectedIds = useViewer((s) => s.selection.selectedIds)
  const setSelection = useViewer((s) => s.setSelection)
  const nodes = useScene((s) => s.nodes)
  const updateNode = useScene((s) => s.updateNode)

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

  if (!node || node.type !== 'window' || selectedIds.length !== 1) return null

  const numCols = node.columnRatios.length
  const numRows = node.rowRatios.length

  // Normalized ratios (always sum to 1 for display)
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
    <div className="pointer-events-auto fixed top-20 right-4 z-50 flex w-82 flex-col overflow-hidden rounded-lg border border-border bg-background/95 shadow-xl backdrop-blur-md">
      {/* Header */}
      <div className="flex items-center justify-between gap-2 border-b p-3">
        <div className="flex items-center gap-2 min-w-0">
          <Image src="/icons/window.png" alt="" width={16} height={16} className="shrink-0 object-contain" />
          <h2 className="font-semibold text-foreground text-sm truncate">
            {node.name || `Window (${node.width}×${node.height}m)`}
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
          <div className="grid grid-cols-2 gap-2">
            <NumberInput
              label="X"
              value={Math.round(node.position[0] * 100) / 100}
              onChange={(v) => handleUpdate({ position: [v, node.position[1], node.position[2]] })}
              precision={2}
            />
            <NumberInput
              label="Y"
              value={Math.round(node.position[1] * 100) / 100}
              onChange={(v) => handleUpdate({ position: [node.position[0], v, node.position[2]] })}
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
                min={0.2}
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
                min={0.2}
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

        {/* Grid */}
        <div className="space-y-2">
          <label className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
            Grid
          </label>
          <div className="grid grid-cols-2 gap-2">
            <NumberInput
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
            <NumberInput
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
          </div>

          {/* Column ratios */}
          {numCols > 1 && (
            <div className="space-y-1">
              <span className="text-muted-foreground text-xs">Column widths</span>
              {normCols.map((ratio, i) => (
                <div key={i} className="flex items-center gap-1.5">
                  <NumberInput
                    label={`C${i + 1}`}
                    value={Math.round(ratio * 100 * 10) / 10}
                    onChange={(v) => setColumnRatio(i, v / 100)}
                    min={5}
                    max={95}
                    precision={1}
                    step={1}
                    className="flex-1"
                  />
                  <span className="text-muted-foreground text-xs shrink-0">%</span>
                </div>
              ))}
              <div className="flex items-center gap-1.5">
                <NumberInput
                  label="Col divider"
                  value={Math.round((node.columnDividerThickness ?? 0.03) * 1000) / 1000}
                  onChange={(v) => handleUpdate({ columnDividerThickness: v })}
                  min={0.005}
                  precision={3}
                  step={0.01}
                  className="flex-1"
                />
                <span className="text-muted-foreground text-xs shrink-0">m</span>
              </div>
            </div>
          )}

          {/* Row ratios */}
          {numRows > 1 && (
            <div className="space-y-1">
              <span className="text-muted-foreground text-xs">Row heights</span>
              {normRows.map((ratio, i) => (
                <div key={i} className="flex items-center gap-1.5">
                  <NumberInput
                    label={`R${i + 1}`}
                    value={Math.round(ratio * 100 * 10) / 10}
                    onChange={(v) => setRowRatio(i, v / 100)}
                    min={5}
                    max={95}
                    precision={1}
                    step={1}
                    className="flex-1"
                  />
                  <span className="text-muted-foreground text-xs shrink-0">%</span>
                </div>
              ))}
              <div className="flex items-center gap-1.5">
                <NumberInput
                  label="Row divider"
                  value={Math.round((node.rowDividerThickness ?? 0.03) * 1000) / 1000}
                  onChange={(v) => handleUpdate({ rowDividerThickness: v })}
                  min={0.005}
                  precision={3}
                  step={0.01}
                  className="flex-1"
                />
                <span className="text-muted-foreground text-xs shrink-0">m</span>
              </div>
            </div>
          )}
        </div>

        {/* Sill */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
              Sill
            </label>
            <Switch
              checked={node.sill}
              onCheckedChange={(checked) => handleUpdate({ sill: checked })}
            />
          </div>
          {node.sill && (
            <div className="grid grid-cols-2 gap-2">
              <div className="flex items-center gap-1.5">
                <NumberInput
                  label="Depth"
                  value={Math.round(node.sillDepth * 1000) / 1000}
                  onChange={(v) => handleUpdate({ sillDepth: v })}
                  min={0.01}
                  precision={3}
                  step={0.01}
                  className="flex-1"
                />
                <span className="text-muted-foreground text-xs shrink-0">m</span>
              </div>
              <div className="flex items-center gap-1.5">
                <NumberInput
                  label="Thickness"
                  value={Math.round(node.sillThickness * 1000) / 1000}
                  onChange={(v) => handleUpdate({ sillThickness: v })}
                  min={0.005}
                  precision={3}
                  step={0.01}
                  className="flex-1"
                />
                <span className="text-muted-foreground text-xs shrink-0">m</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

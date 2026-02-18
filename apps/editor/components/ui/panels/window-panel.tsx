'use client'

import { type AnyNode, type AnyNodeId, type WindowNode, useScene } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { X } from 'lucide-react'
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
      // Mark dirty so window-system regenerates geometry
      useScene.getState().dirtyNodes.add(selectedId as AnyNodeId)
    },
    [selectedId, updateNode],
  )

  const handleClose = useCallback(() => {
    setSelection({ selectedIds: [] })
  }, [setSelection])

  if (!node || node.type !== 'window' || selectedIds.length !== 1) return null

  const columns = node.columnRatios.length
  const rows = node.rowRatios.length

  return (
    <div className="pointer-events-auto fixed top-20 right-4 z-50 flex w-72 flex-col overflow-hidden rounded-lg border border-border bg-background/95 shadow-xl backdrop-blur-md">
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
        {/* Dimensions */}
        <div className="space-y-2">
          <label className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
            Dimensions
          </label>
          <div className="grid grid-cols-2 gap-2">
            <div className="flex items-center gap-1.5">
              <NumberInput
                label="Width"
                value={Math.round(node.width * 1000) / 1000}
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
                value={Math.round(node.height * 1000) / 1000}
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
            <div className="flex items-center gap-1.5">
              <NumberInput
                label="Columns"
                value={columns}
                onChange={(v) => {
                  const n = Math.max(1, Math.min(8, Math.round(v)))
                  handleUpdate({ columnRatios: Array(n).fill(1) })
                }}
                min={1}
                max={8}
                precision={0}
                className="flex-1"
              />
            </div>
            <div className="flex items-center gap-1.5">
              <NumberInput
                label="Rows"
                value={rows}
                onChange={(v) => {
                  const n = Math.max(1, Math.min(8, Math.round(v)))
                  handleUpdate({ rowRatios: Array(n).fill(1) })
                }}
                min={1}
                max={8}
                precision={0}
                className="flex-1"
              />
            </div>
          </div>
          {(columns > 1 || rows > 1) && (
            <div className="flex items-center gap-1.5">
              <NumberInput
                label="Divider thickness"
                value={Math.round(node.dividerThickness * 1000) / 1000}
                onChange={(v) => handleUpdate({ dividerThickness: v })}
                min={0.005}
                precision={3}
                className="flex-1"
              />
              <span className="text-muted-foreground text-xs shrink-0">m</span>
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

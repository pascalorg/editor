'use client'

import { type AnyNode, type RoofNode, useScene } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { X } from 'lucide-react'
import Image from 'next/image'
import { useCallback } from 'react'

export function RoofPanel() {
  const selectedIds = useViewer((s) => s.selection.selectedIds)
  const setSelection = useViewer((s) => s.setSelection)
  const nodes = useScene((s) => s.nodes)
  const updateNode = useScene((s) => s.updateNode)

  // Get the first selected node if it's a roof
  const selectedId = selectedIds[0]
  const node = selectedId
    ? (nodes[selectedId as AnyNode['id']] as RoofNode | undefined)
    : undefined

  const handleUpdate = useCallback(
    (updates: Partial<RoofNode>) => {
      if (!selectedId) return
      updateNode(selectedId as AnyNode['id'], updates)
    },
    [selectedId, updateNode],
  )

  const handleClose = useCallback(() => {
    setSelection({ selectedIds: [] })
  }, [setSelection])

  // Only show if exactly one roof is selected
  if (!node || node.type !== 'roof' || selectedIds.length !== 1) return null

  // Calculate total width for display
  const totalWidth = node.leftWidth + node.rightWidth

  return (
    <div className="pointer-events-auto fixed top-20 right-4 z-50 flex w-72 flex-col overflow-hidden rounded-lg border border-border bg-background/95 shadow-xl backdrop-blur-md">
      {/* Header */}
      <div className="flex items-center justify-between gap-2 border-b p-3">
        <div className="flex items-center gap-2 min-w-0">
          <Image src="/icons/roof.png" alt="" width={16} height={16} className="shrink-0 object-contain" />
          <h2 className="font-semibold text-foreground text-sm truncate">
            {node.name || 'Gable Roof'}
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
      <div className="flex-1 overflow-y-auto p-3">
        <div className="space-y-4">
          {/* Length */}
          <div className="space-y-2">
            <label className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
              Length
            </label>
            <div className="flex items-center gap-2">
              <input
                className="flex-1 rounded border border-input bg-background px-2 py-1 text-foreground text-sm outline-none focus:border-primary"
                min="0.5"
                onChange={(e) => {
                  const value = Number.parseFloat(e.target.value)
                  if (!Number.isNaN(value) && value > 0) {
                    handleUpdate({ length: value })
                  }
                }}
                step="0.5"
                type="number"
                value={Math.round(node.length * 100) / 100}
              />
              <span className="text-muted-foreground text-xs shrink-0">m</span>
            </div>
          </div>

          {/* Height */}
          <div className="space-y-2">
            <label className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
              Height
            </label>
            <div className="flex items-center gap-2">
              <input
                className="flex-1 rounded border border-input bg-background px-2 py-1 text-foreground text-sm outline-none focus:border-primary"
                min="0.1"
                onChange={(e) => {
                  const value = Number.parseFloat(e.target.value)
                  if (!Number.isNaN(value) && value > 0) {
                    handleUpdate({ height: value })
                  }
                }}
                step="0.1"
                type="number"
                value={Math.round(node.height * 100) / 100}
              />
              <span className="text-muted-foreground text-xs shrink-0">m</span>
            </div>
          </div>

          {/* Slope Widths */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
                Slope Widths
              </label>
              <span className="text-muted-foreground text-xs">
                Total: {totalWidth.toFixed(1)}m
              </span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <label className="text-muted-foreground text-xs">Left</label>
                <div className="flex items-center gap-1">
                  <input
                    className="w-full rounded border border-input bg-background px-2 py-1 text-foreground text-sm outline-none focus:border-primary"
                    min="0.1"
                    onChange={(e) => {
                      const value = Number.parseFloat(e.target.value)
                      if (!Number.isNaN(value) && value > 0) {
                        handleUpdate({ leftWidth: value })
                      }
                    }}
                    step="0.1"
                    type="number"
                    value={Math.round(node.leftWidth * 100) / 100}
                  />
                  <span className="text-muted-foreground text-xs shrink-0">m</span>
                </div>
              </div>
              <div className="space-y-1">
                <label className="text-muted-foreground text-xs">Right</label>
                <div className="flex items-center gap-1">
                  <input
                    className="w-full rounded border border-input bg-background px-2 py-1 text-foreground text-sm outline-none focus:border-primary"
                    min="0.1"
                    onChange={(e) => {
                      const value = Number.parseFloat(e.target.value)
                      if (!Number.isNaN(value) && value > 0) {
                        handleUpdate({ rightWidth: value })
                      }
                    }}
                    step="0.1"
                    type="number"
                    value={Math.round(node.rightWidth * 100) / 100}
                  />
                  <span className="text-muted-foreground text-xs shrink-0">m</span>
                </div>
              </div>
            </div>
          </div>

          {/* Rotation */}
          <div className="space-y-2">
            <label className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
              Rotation
            </label>
            <div className="flex items-center gap-1.5">
              <input
                className="min-w-0 flex-1 rounded border border-input bg-background px-2 py-1 text-foreground text-sm outline-none focus:border-primary"
                onChange={(e) => {
                  const degrees = Number.parseFloat(e.target.value)
                  if (!Number.isNaN(degrees)) {
                    const radians = (degrees * Math.PI) / 180
                    handleUpdate({ rotation: radians })
                  }
                }}
                step="1"
                type="number"
                value={Math.round((node.rotation * 180) / Math.PI)}
              />
              <span className="text-muted-foreground text-xs shrink-0">&deg;</span>
              <button
                type="button"
                className="shrink-0 rounded border border-border px-1.5 py-0.5 text-xs hover:bg-accent cursor-pointer"
                onClick={() => {
                  const newRotation = node.rotation - Math.PI / 2
                  handleUpdate({ rotation: newRotation })
                }}
              >
                &minus;90
              </button>
              <button
                type="button"
                className="shrink-0 rounded border border-border px-1.5 py-0.5 text-xs hover:bg-accent cursor-pointer"
                onClick={() => {
                  const newRotation = node.rotation + Math.PI / 2
                  handleUpdate({ rotation: newRotation })
                }}
              >
                +90
              </button>
            </div>
          </div>

          {/* Position */}
          <div className="space-y-2">
            <label className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
              Position
            </label>
            <div className="grid grid-cols-3 gap-2">
              {([0, 1, 2] as const).map((i) => (
                <div key={i} className="space-y-1">
                  <label className="text-muted-foreground text-xs">{['X', 'Y', 'Z'][i]}</label>
                  <input
                    className="w-full rounded border border-input bg-background px-2 py-1 text-foreground text-sm outline-none focus:border-primary"
                    onChange={(e) => {
                      const value = Number.parseFloat(e.target.value)
                      if (!Number.isNaN(value)) {
                        const pos = [...node.position] as [number, number, number]
                        pos[i] = value
                        handleUpdate({ position: pos })
                      }
                    }}
                    step="0.5"
                    type="number"
                    value={Math.round(node.position[i] * 100) / 100}
                  />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

'use client'

import { type AnyNode, type SlabNode, useScene } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { X } from 'lucide-react'
import Image from 'next/image'
import { useCallback } from 'react'

export function SlabPanel() {
  const selectedIds = useViewer((s) => s.selection.selectedIds)
  const setSelection = useViewer((s) => s.setSelection)
  const nodes = useScene((s) => s.nodes)
  const updateNode = useScene((s) => s.updateNode)

  // Get the first selected node if it's a slab
  const selectedId = selectedIds[0]
  const node = selectedId
    ? (nodes[selectedId as AnyNode['id']] as SlabNode | undefined)
    : undefined

  const handleUpdate = useCallback(
    (updates: Partial<SlabNode>) => {
      if (!selectedId) return
      updateNode(selectedId as AnyNode['id'], updates)
    },
    [selectedId, updateNode],
  )

  const handleClose = useCallback(() => {
    setSelection({ selectedIds: [] })
  }, [setSelection])

  // Only show if exactly one slab is selected
  if (!node || node.type !== 'slab' || selectedIds.length !== 1) return null

  // Calculate approximate area from polygon
  const calculateArea = (polygon: Array<[number, number]>): number => {
    if (polygon.length < 3) return 0
    let area = 0
    const n = polygon.length
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n
      area += polygon[i]![0] * polygon[j]![1]
      area -= polygon[j]![0] * polygon[i]![1]
    }
    return Math.abs(area) / 2
  }

  const area = calculateArea(node.polygon)

  return (
    <div className="pointer-events-auto fixed top-20 right-4 z-50 flex w-72 flex-col overflow-hidden rounded-lg border border-border bg-background/95 shadow-xl backdrop-blur-md">
      {/* Header */}
      <div className="flex items-center justify-between gap-2 border-b p-3">
        <div className="flex items-center gap-2 min-w-0">
          <Image src="/icons/floor.png" alt="" width={16} height={16} className="shrink-0 object-contain" />
          <h2 className="font-semibold text-foreground text-sm truncate">
            {node.name || `Slab (${area.toFixed(1)}m²)`}
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
          {/* Elevation */}
          <div className="space-y-2">
            <label className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
              Elevation
            </label>
            <div className="flex items-center gap-2">
              <input
                className="flex-1 rounded border border-input bg-background px-2 py-1 text-foreground text-sm outline-none focus:border-primary"
                onChange={(e) => {
                  const value = Number.parseFloat(e.target.value)
                  if (!Number.isNaN(value)) {
                    handleUpdate({ elevation: value })
                  }
                }}
                step="0.05"
                type="number"
                value={Math.round(node.elevation * 1000) / 1000}
              />
              <span className="text-muted-foreground text-xs shrink-0">m</span>
            </div>
            <p className="text-xs text-muted-foreground">
              Height offset from the level base (positive = raised, negative = sunken)
            </p>
          </div>

          {/* Quick preset buttons */}
          <div className="space-y-2">
            <label className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
              Presets
            </label>
            <div className="grid grid-cols-4 gap-2">
              <button
                type="button"
                className="rounded border border-border px-2 py-1.5 text-xs hover:bg-accent cursor-pointer"
                onClick={() => handleUpdate({ elevation: -0.15 })}
              >
                Sunken (-15cm)
              </button>
              <button
                type="button"
                className="rounded border border-border px-2 py-1.5 text-xs hover:bg-accent cursor-pointer"
                onClick={() => handleUpdate({ elevation: 0 })}
              >
                Ground (0m)
              </button>
              <button
                type="button"
                className="rounded border border-border px-2 py-1.5 text-xs hover:bg-accent cursor-pointer"
                onClick={() => handleUpdate({ elevation: 0.05 })}
              >
                Raised (5cm)
              </button>
              <button
                type="button"
                className="rounded border border-border px-2 py-1.5 text-xs hover:bg-accent cursor-pointer"
                onClick={() => handleUpdate({ elevation: 0.15 })}
              >
                Step (15cm)
              </button>
            </div>
          </div>

          {/* Area info */}
          <div className="space-y-2">
            <label className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
              Area
            </label>
            <div className="rounded border border-border bg-muted/50 px-3 py-2 text-sm">
              {area.toFixed(2)} m²
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

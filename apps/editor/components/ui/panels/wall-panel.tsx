'use client'

import { type AnyNode, type AnyNodeId, type WallNode, useScene } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { X } from 'lucide-react'
import Image from 'next/image'
import { useCallback } from 'react'
import { NumberInput } from '@/components/ui/primitives/number-input'

export function WallPanel() {
  const selectedIds = useViewer((s) => s.selection.selectedIds)
  const setSelection = useViewer((s) => s.setSelection)
  const nodes = useScene((s) => s.nodes)
  const updateNode = useScene((s) => s.updateNode)

  const selectedId = selectedIds[0]
  const node = selectedId
    ? (nodes[selectedId as AnyNode['id']] as WallNode | undefined)
    : undefined

  const handleUpdate = useCallback(
    (updates: Partial<WallNode>) => {
      if (!selectedId) return
      updateNode(selectedId as AnyNode['id'], updates)
      useScene.getState().dirtyNodes.add(selectedId as AnyNodeId)
    },
    [selectedId, updateNode],
  )

  const handleClose = useCallback(() => {
    setSelection({ selectedIds: [] })
  }, [setSelection])

  if (!node || node.type !== 'wall' || selectedIds.length !== 1) return null

  const dx = node.end[0] - node.start[0]
  const dz = node.end[1] - node.start[1]
  const length = Math.sqrt(dx * dx + dz * dz)

  const height = node.height ?? 2.5
  const thickness = node.thickness ?? 0.1

  return (
    <div className="pointer-events-auto fixed top-20 right-4 z-50 flex w-64 flex-col overflow-hidden rounded-lg border border-border bg-background/95 shadow-xl backdrop-blur-md">
      {/* Header */}
      <div className="flex items-center justify-between gap-2 border-b p-3">
        <div className="flex items-center gap-2 min-w-0">
          <Image src="/icons/wall.png" alt="" width={16} height={16} className="shrink-0 object-contain" />
          <h2 className="font-semibold text-foreground text-sm truncate">
            {node.name || `Wall (${length.toFixed(2)}m)`}
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
          <div className="flex items-center gap-1.5">
            <NumberInput
              label="Height"
              value={Math.round(height * 100) / 100}
              onChange={(v) => handleUpdate({ height: Math.max(0.1, v) })}
              min={0.1}
              precision={2}
              step={0.1}
              className="flex-1"
            />
            <span className="text-muted-foreground text-xs shrink-0">m</span>
          </div>
          <div className="flex items-center gap-1.5">
            <NumberInput
              label="Thickness"
              value={Math.round(thickness * 1000) / 1000}
              onChange={(v) => handleUpdate({ thickness: Math.max(0.05, v) })}
              min={0.05}
              precision={3}
              step={0.01}
              className="flex-1"
            />
            <span className="text-muted-foreground text-xs shrink-0">m</span>
          </div>
        </div>

        {/* Info */}
        <div className="space-y-2">
          <label className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
            Info
          </label>
          <div className="rounded border border-border bg-muted/50 px-3 py-2 text-sm">
            Length: {length.toFixed(2)} m
          </div>
        </div>
      </div>
    </div>
  )
}

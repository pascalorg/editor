'use client'

import { Box, X } from 'lucide-react'
import { useCallback } from 'react'
import { useShallow } from 'zustand/shallow'
import { type StoreState, useEditor } from '@/hooks/use-editor'
import type { ScanNode } from '@/lib/scenegraph/schema/nodes/scan'

/**
 * Scan properties editor panel
 * Only visible when a scan node is selected and in edit or guide mode
 */
export function ScanUI() {
  const { nodeId, node, setControlMode } = useEditor(
    useShallow((state: StoreState) => {
      const base = {
        nodeId: null as string | null,
        node: undefined as ScanNode | undefined,
        setControlMode: state.setControlMode,
      }

      // Show in guide, select or edit mode if a scan is selected
      if (
        state.controlMode !== 'guide' &&
        state.controlMode !== 'select' &&
        state.controlMode !== 'edit'
      ) {
        return base
      }

      // Find selected scan node
      if (state.selectedNodeIds.length !== 1) return base
      const handle = state.graph.getNodeById(state.selectedNodeIds[0] as any)
      const n = handle?.data()
      if (n?.type !== 'scan') return base

      return {
        nodeId: n.id,
        node: n as ScanNode,
        setControlMode: state.setControlMode,
      }
    }),
  )

  const updateNode = useEditor((state) => state.updateNode)

  const handleUpdate = useCallback(
    (updates: Partial<ScanNode>) => {
      if (!nodeId) return
      updateNode(nodeId, updates)
    },
    [nodeId, updateNode],
  )

  const handleClose = useCallback(() => {
    setControlMode('select')
  }, [setControlMode])

  if (!(nodeId && node)) return null

  // Helper to safely update position components
  const updatePosition = (index: 0 | 1 | 2, value: number) => {
    const newPos = [...node.position] as [number, number, number]
    newPos[index] = value
    handleUpdate({ position: newPos })
  }

  // Helper to safely update rotation components
  const updateRotation = (index: 0 | 1 | 2, value: number) => {
    const newRot = [...node.rotation] as [number, number, number]
    newRot[index] = value
    handleUpdate({ rotation: newRot })
  }

  return (
    <div className="pointer-events-auto fixed top-20 right-4 z-50 flex w-80 flex-col overflow-hidden rounded-lg border border-border bg-background/95 shadow-xl backdrop-blur-md">
      {/* Header */}
      <div className="flex items-center justify-between border-b p-4">
        <div className="flex items-center gap-2">
          <Box className="h-5 w-5 text-purple-400" />
          <h1 className="font-bold text-foreground text-lg">3D Scan</h1>
        </div>
        <button
          className="rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          onClick={handleClose}
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4">
        <div className="space-y-6">
          <div className="space-y-4">
            {/* Position */}
            <h2 className="font-semibold text-muted-foreground text-xs uppercase tracking-wider">
              Position
            </h2>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <label className="font-medium text-muted-foreground text-xs">X (grid)</label>
                <input
                  className="w-full rounded border border-input bg-background p-2 text-foreground text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary"
                  onChange={(e) => {
                    const value = Number.parseFloat(e.target.value)
                    if (!Number.isNaN(value)) {
                      updatePosition(0, value)
                    }
                  }}
                  step="0.1"
                  type="number"
                  value={Math.round(node.position[0] * 100) / 100}
                />
              </div>
              <div className="space-y-1">
                <label className="font-medium text-muted-foreground text-xs">Z (grid)</label>
                <input
                  className="w-full rounded border border-input bg-background p-2 text-foreground text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary"
                  onChange={(e) => {
                    const value = Number.parseFloat(e.target.value)
                    if (!Number.isNaN(value)) {
                      updatePosition(1, value)
                    }
                  }}
                  step="0.1"
                  type="number"
                  value={Math.round(node.position[1] * 100) / 100}
                />
              </div>
              <div className="space-y-1 col-span-2">
                <label className="font-medium text-muted-foreground text-xs">Y Offset (m)</label>
                <input
                  className="w-full rounded border border-input bg-background p-2 text-foreground text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary"
                  onChange={(e) => {
                    const value = Number.parseFloat(e.target.value)
                    if (!Number.isNaN(value)) {
                      updatePosition(2, value)
                    }
                  }}
                  step="0.1"
                  type="number"
                  value={Math.round(node.position[2] * 100) / 100}
                />
              </div>
            </div>

            {/* Rotation */}
            <div className="space-y-1">
              <label className="font-medium text-muted-foreground text-xs">Rotation Y (°)</label>
              <div className="flex items-center gap-2">
                <input
                  className="flex-1 rounded border border-input bg-background p-2 text-foreground text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary"
                  onChange={(e) => {
                    const degrees = Number.parseFloat(e.target.value)
                    if (!Number.isNaN(degrees)) {
                      updateRotation(1, degrees)
                    }
                  }}
                  step="1"
                  type="number"
                  value={Math.round(node.rotation[1])}
                />
                <div className="flex gap-1">
                  <button
                    className="rounded border border-border px-2 py-1 text-xs hover:bg-accent"
                    onClick={() => updateRotation(1, node.rotation[1] - 45)}
                  >
                    -45°
                  </button>
                  <button
                    className="rounded border border-border px-2 py-1 text-xs hover:bg-accent"
                    onClick={() => updateRotation(1, node.rotation[1] + 45)}
                  >
                    +45°
                  </button>
                </div>
              </div>
            </div>

            {/* Scale */}
            <div className="space-y-1">
              <label className="font-medium text-muted-foreground text-xs">Scale</label>
              <input
                className="w-full rounded border border-input bg-background p-2 text-foreground text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary"
                min="0.1"
                onChange={(e) => {
                  const value = Number.parseFloat(e.target.value)
                  if (!Number.isNaN(value) && value > 0) {
                    handleUpdate({ scale: value })
                  }
                }}
                step="0.1"
                type="number"
                value={Math.round(node.scale * 100) / 100}
              />
            </div>

            {/* Opacity */}
            <div className="space-y-1">
              <div className="flex justify-between">
                <label className="font-medium text-muted-foreground text-xs">Opacity</label>
                <span className="text-muted-foreground text-xs">{node.opacity}%</span>
              </div>
              <input
                className="w-full cursor-pointer"
                max="100"
                min="0"
                onChange={(e) => handleUpdate({ opacity: Number.parseInt(e.target.value, 10) })}
                step="1"
                type="range"
                value={node.opacity}
              />
            </div>
          </div>

          <hr className="border-border" />

          {/* Help */}
          <p className="text-muted-foreground text-xs">
            Use the handles in the 3D view to move, rotate, and scale the scan. Hold Shift while
            dragging to snap to grid/increments.
          </p>
        </div>
      </div>
    </div>
  )
}


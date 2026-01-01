'use client'

import { Image, X } from 'lucide-react'
import { useCallback, useMemo } from 'react'
import { useShallow } from 'zustand/shallow'
import { type StoreState, useEditor } from '../../../hooks'
import type { ImageNode } from '@pascal/core'

/**
 * Image properties editor panel
 * Only visible when an image node is selected and in edit or guide mode
 */
export function ImageUI() {
  const { nodeId, node, setControlMode } = useEditor(
    useShallow((state: StoreState) => {
      const base = {
        nodeId: null as string | null,
        node: undefined as ImageNode | undefined,
        setControlMode: state.setControlMode,
      }

      // Show in guide, select or edit mode if an image is selected
      if (
        state.controlMode !== 'guide' &&
        state.controlMode !== 'select' &&
        state.controlMode !== 'edit'
      ) {
        return base
      }

      // Find selected image node
      if (state.selectedNodeIds.length !== 1) return base
      const handle = state.graph.getNodeById(state.selectedNodeIds[0] as any)
      const n = handle?.data()
      if (n?.type !== 'reference-image') return base

      return {
        nodeId: n.id,
        node: n as ImageNode,
        setControlMode: state.setControlMode,
      }
    }),
  )

  const updateNode = useEditor((state) => state.updateNode)

  const handleUpdate = useCallback(
    (updates: Partial<ImageNode>) => {
      if (!nodeId) return
      updateNode(nodeId, updates)
    },
    [nodeId, updateNode],
  )

  const handleClose = useCallback(() => {
    setControlMode('select')
  }, [setControlMode])

  if (!(nodeId && node)) return null

  return (
    <div className="pointer-events-auto fixed top-20 right-4 z-50 flex w-80 flex-col overflow-hidden rounded-lg border border-border bg-background/95 shadow-xl backdrop-blur-md">
      {/* Header */}
      <div className="flex items-center justify-between border-b p-4">
        <div className="flex items-center gap-2">
          <Image className="h-5 w-5 text-purple-400" />
          <h1 className="font-bold text-foreground text-lg">Reference Image</h1>
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
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <label className="font-medium text-muted-foreground text-xs">X (m)</label>
                <input
                  className="w-full rounded border border-input bg-background p-2 text-foreground text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary"
                  onChange={(e) => {
                    const value = Number.parseFloat(e.target.value)
                    if (!Number.isNaN(value)) {
                      handleUpdate({ position: [value, node.position[1]] })
                    }
                  }}
                  step="0.1"
                  type="number"
                  value={Math.round(node.position[0] * 100) / 100}
                />
              </div>
              <div className="space-y-1">
                <label className="font-medium text-muted-foreground text-xs">Z (m)</label>
                <input
                  className="w-full rounded border border-input bg-background p-2 text-foreground text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary"
                  onChange={(e) => {
                    const value = Number.parseFloat(e.target.value)
                    if (!Number.isNaN(value)) {
                      handleUpdate({ position: [node.position[0], value] })
                    }
                  }}
                  step="0.1"
                  type="number"
                  value={Math.round(node.position[1] * 100) / 100}
                />
              </div>
            </div>

            {/* Rotation */}
            <div className="space-y-1">
              <label className="font-medium text-muted-foreground text-xs">Rotation (°)</label>
              <div className="flex items-center gap-2">
                <input
                  className="flex-1 rounded border border-input bg-background p-2 text-foreground text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary"
                  onChange={(e) => {
                    const degrees = Number.parseFloat(e.target.value)
                    if (!Number.isNaN(degrees)) {
                      const radians = (degrees * Math.PI) / 180
                      handleUpdate({
                        rotation: [node.rotation[0], radians, node.rotation[2]],
                      })
                    }
                  }}
                  step="1"
                  type="number"
                  value={Math.round((node.rotation[1] * 180) / Math.PI)}
                />
                <div className="flex gap-1">
                  <button
                    className="rounded border border-border px-2 py-1 text-xs hover:bg-accent"
                    onClick={() =>
                      handleUpdate({
                        rotation: [
                          node.rotation[0],
                          node.rotation[1] - Math.PI / 4,
                          node.rotation[2],
                        ],
                      })
                    }
                  >
                    -45°
                  </button>
                  <button
                    className="rounded border border-border px-2 py-1 text-xs hover:bg-accent"
                    onClick={() =>
                      handleUpdate({
                        rotation: [
                          node.rotation[0],
                          node.rotation[1] + Math.PI / 4,
                          node.rotation[2],
                        ],
                      })
                    }
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
            Use the handles in the 3D view to move, rotate, and scale the reference image. Hold
            Shift while dragging to snap to grid/increments.
          </p>
        </div>
      </div>
    </div>
  )
}

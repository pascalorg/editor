'use client'

import { X } from 'lucide-react'
import { useShallow } from 'zustand/shallow'
import { useEditor } from '@/hooks/use-editor'
import type { RoofNode } from '@pascal/core/scenegraph/schema/nodes/roof'

export function RoofUI() {
  const { updateNode, controlMode, setControlMode } = useEditor(
    useShallow((state) => ({
      updateNode: state.updateNode,
      controlMode: state.controlMode,
      setControlMode: state.setControlMode,
    })),
  )

  const node = useEditor((state) => {
    if (state.selectedNodeIds.length !== 1) return null
    const n = state.graph.getNodeById(state.selectedNodeIds[0] as any)?.data()
    return n?.type === 'roof' ? (n as RoofNode) : null
  })

  if (!node || controlMode !== 'edit') return null

  const handleClose = () => {
    setControlMode('select')
  }

  return (
    <div className="pointer-events-auto fixed top-20 right-4 z-50 flex h-auto w-80 flex-col overflow-hidden rounded-lg border border-border bg-background/95 shadow-xl backdrop-blur-md">
      {/* Header */}
      <div className="flex items-center justify-between border-b p-4">
        <h1 className="font-bold text-foreground text-lg">Roof Designer</h1>
        <button
          className="rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          onClick={handleClose}
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        <div className="space-y-4">
          <div className="space-y-1">
            <label className="font-medium text-muted-foreground text-xs">Height (m)</label>
            <input
              className="w-full rounded border border-input bg-background p-2 text-foreground text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary"
              onChange={(e) =>
                updateNode(node.id, {
                  height: Number.parseFloat(e.target.value),
                })
              }
              step="0.1"
              type="number"
              value={node.height}
            />
          </div>

          <div className="space-y-1">
            <label className="font-medium text-muted-foreground text-xs">Length (m)</label>
            <input
              className="w-full rounded border border-input bg-background p-2 text-foreground text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary"
              onChange={(e) => {
                const newLength = Number.parseFloat(e.target.value)
                if (!Number.isNaN(newLength)) {
                  updateNode(node.id, {
                    size: [newLength, node.size[1]],
                  })
                }
              }}
              step="0.1"
              type="number"
              value={Number(node.size[0]).toFixed(2)}
            />
          </div>

          <div className="space-y-1">
            <label className="font-medium text-muted-foreground text-xs">Left Width (m)</label>
            <input
              className="w-full rounded border border-input bg-background p-2 text-foreground text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary"
              onChange={(e) =>
                updateNode(node.id, {
                  leftWidth: Number.parseFloat(e.target.value),
                })
              }
              step="0.1"
              type="number"
              value={node.leftWidth}
            />
          </div>

          <div className="space-y-1">
            <label className="font-medium text-muted-foreground text-xs">Right Width (m)</label>
            <input
              className="w-full rounded border border-input bg-background p-2 text-foreground text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary"
              onChange={(e) =>
                updateNode(node.id, {
                  rightWidth: Number.parseFloat(e.target.value),
                })
              }
              step="0.1"
              type="number"
              value={node.rightWidth}
            />
          </div>
        </div>
      </div>
    </div>
  )
}


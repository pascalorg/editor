'use client'

import { type AnyNode, type GuideNode, type ScanNode, useScene } from '@pascal-app/core'
import { Box, Image, X } from 'lucide-react'
import { useCallback } from 'react'
import useEditor from '@/store/use-editor'

type ReferenceNode = ScanNode | GuideNode

export function ReferencePanel() {
  const selectedReferenceId = useEditor((s) => s.selectedReferenceId)
  const setSelectedReferenceId = useEditor((s) => s.setSelectedReferenceId)
  const nodes = useScene((s) => s.nodes)
  const updateNode = useScene((s) => s.updateNode)

  const node = selectedReferenceId
    ? (nodes[selectedReferenceId as AnyNode['id']] as ReferenceNode | undefined)
    : undefined

  const handleUpdate = useCallback(
    (updates: Partial<ReferenceNode>) => {
      if (!selectedReferenceId) return
      updateNode(selectedReferenceId as AnyNode['id'], updates)
    },
    [selectedReferenceId, updateNode],
  )

  const handleClose = useCallback(() => {
    setSelectedReferenceId(null)
  }, [setSelectedReferenceId])

  if (!node || (node.type !== 'scan' && node.type !== 'guide')) return null

  const isScan = node.type === 'scan'

  return (
    <div className="pointer-events-auto fixed top-20 right-4 z-50 flex w-72 flex-col overflow-hidden rounded-lg border border-border bg-background/95 shadow-xl backdrop-blur-md">
      {/* Header */}
      <div className="flex items-center justify-between gap-2 border-b p-3">
        <div className="flex items-center gap-2 min-w-0">
          {isScan ? (
            <Box className="h-4 w-4 shrink-0 text-muted-foreground" />
          ) : (
            <Image className="h-4 w-4 shrink-0 text-muted-foreground" />
          )}
          <h2 className="font-semibold text-foreground text-sm truncate">
            {node.name || (isScan ? '3D Scan' : 'Guide Image')}
          </h2>
        </div>
        <button
          className="shrink-0 rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground cursor-pointer"
          onClick={handleClose}
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-3">
        <div className="space-y-4">
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
                    step="0.1"
                    type="number"
                    value={Math.round(node.position[i] * 100) / 100}
                  />
                </div>
              ))}
            </div>
          </div>

          {/* Rotation Y */}
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
                    handleUpdate({
                      rotation: [node.rotation[0], radians, node.rotation[2]],
                    })
                  }
                }}
                step="1"
                type="number"
                value={Math.round((node.rotation[1] * 180) / Math.PI)}
              />
              <span className="text-muted-foreground text-xs shrink-0">&deg;</span>
              <button
                className="shrink-0 rounded border border-border px-1.5 py-0.5 text-xs hover:bg-accent cursor-pointer"
                onClick={() =>
                  handleUpdate({
                    rotation: [node.rotation[0], node.rotation[1] - Math.PI / 4, node.rotation[2]],
                  })
                }
              >
                &minus;45
              </button>
              <button
                className="shrink-0 rounded border border-border px-1.5 py-0.5 text-xs hover:bg-accent cursor-pointer"
                onClick={() =>
                  handleUpdate({
                    rotation: [node.rotation[0], node.rotation[1] + Math.PI / 4, node.rotation[2]],
                  })
                }
              >
                +45
              </button>
            </div>
          </div>

          {/* Scale */}
          <div className="space-y-2">
            <label className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
              Scale
            </label>
            <input
              className="w-full rounded border border-input bg-background px-2 py-1 text-foreground text-sm outline-none focus:border-primary"
              min="0.01"
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
          <div className="space-y-2">
            <div className="flex justify-between">
              <label className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
                Opacity
              </label>
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
      </div>
    </div>
  )
}

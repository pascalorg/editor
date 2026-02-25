'use client'

import { type AnyNode, type GuideNode, type ScanNode, useScene } from '@pascal-app/core'
import { Box, Image, X } from 'lucide-react'
import { useCallback } from 'react'
import useEditor from '@/store/use-editor'
import { NumberInput } from '@/components/ui/primitives/number-input'

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
      <div className="flex items-center justify-between gap-2 border-b border-border/50 p-3 bg-white/50 dark:bg-transparent">
        <div className="flex items-center gap-2 min-w-0">
          {isScan ? (
            <Box className="h-4 w-4 shrink-0 text-muted-foreground" />
          ) : (
            <Image className="h-4 w-4 shrink-0 text-muted-foreground" />
          )}
          <h2 className="font-semibold font-barlow text-foreground text-sm truncate">
            {node.name || (isScan ? '3D Scan' : 'Guide Image')}
          </h2>
        </div>
        <button
          className="shrink-0 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-black/5 dark:hover:bg-white/10 hover:text-foreground cursor-pointer"
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
            <label className="font-medium font-barlow text-muted-foreground text-xs uppercase tracking-wide">
              Position
            </label>
            <div className="grid grid-cols-3 gap-2">
              {([0, 1, 2] as const).map((i) => (
                <NumberInput
                  key={i}
                  label={['X', 'Y', 'Z'][i]!}
                  value={Math.round(node.position[i] * 100) / 100}
                  onChange={(value) => {
                    const pos = [...node.position] as [number, number, number]
                    pos[i] = value
                    handleUpdate({ position: pos })
                  }}
                  precision={2}
                />
              ))}
            </div>
          </div>

          {/* Rotation Y */}
          <div className="space-y-2">
            <label className="font-medium font-barlow text-muted-foreground text-xs uppercase tracking-wide">
              Rotation
            </label>
            <div className="flex items-center gap-1.5">
              <NumberInput
                label="Y"
                value={Math.round((node.rotation[1] * 180) / Math.PI)}
                onChange={(degrees) => {
                  const radians = (degrees * Math.PI) / 180
                  handleUpdate({
                    rotation: [node.rotation[0], radians, node.rotation[2]],
                  })
                }}
                precision={0}
                className="min-w-0 flex-1"
              />
              <span className="text-muted-foreground text-xs shrink-0">&deg;</span>
              <button
                className="shrink-0 rounded-md border border-neutral-200/60 dark:border-border/50 bg-white dark:bg-background shadow-[0_1px_2px_0px_rgba(0,0,0,0.05)] px-1.5 py-1 text-xs font-medium font-barlow text-foreground hover:bg-black/5 dark:hover:bg-white/10 transition-colors cursor-pointer"
                onClick={() =>
                  handleUpdate({
                    rotation: [node.rotation[0], node.rotation[1] - Math.PI / 4, node.rotation[2]],
                  })
                }
              >
                &minus;45
              </button>
              <button
                className="shrink-0 rounded-md border border-neutral-200/60 dark:border-border/50 bg-white dark:bg-background shadow-[0_1px_2px_0px_rgba(0,0,0,0.05)] px-1.5 py-1 text-xs font-medium font-barlow text-foreground hover:bg-black/5 dark:hover:bg-white/10 transition-colors cursor-pointer"
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
            <label className="font-medium font-barlow text-muted-foreground text-xs uppercase tracking-wide">
              Scale
            </label>
            <NumberInput
              label="Scale"
              value={Math.round(node.scale * 100) / 100}
              onChange={(value) => {
                if (value > 0) {
                  handleUpdate({ scale: value })
                }
              }}
              min={0.01}
              precision={2}
            />
          </div>

          {/* Opacity */}
          <div className="space-y-2">
            <div className="flex justify-between">
              <label className="font-medium font-barlow text-muted-foreground text-xs uppercase tracking-wide">
                Opacity
              </label>
              <span className="text-muted-foreground font-mono text-xs">{node.opacity}%</span>
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

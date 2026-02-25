'use client'

import { getScaledDimensions, type AnyNode, ItemNode, useScene } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { Copy, Link, Link2Off, Move, Trash2, X } from 'lucide-react'
import Image from 'next/image'
import { useCallback, useState } from 'react'
import useEditor from '@/store/use-editor'
import { NumberInput } from '@/components/ui/primitives/number-input'
import { sfxEmitter } from '@/lib/sfx-bus'

export function ItemPanel() {
  const selectedIds = useViewer((s) => s.selection.selectedIds)
  const setSelection = useViewer((s) => s.setSelection)
  const nodes = useScene((s) => s.nodes)
  const updateNode = useScene((s) => s.updateNode)
  const deleteNode = useScene((s) => s.deleteNode)
  const setMovingNode = useEditor((s) => s.setMovingNode)

  // Get the first selected node if it's an item
  const selectedId = selectedIds[0]
  const node = selectedId
    ? (nodes[selectedId as AnyNode['id']] as ItemNode | undefined)
    : undefined

  const [uniformScale, setUniformScale] = useState(true)

  const handleUpdate = useCallback(
    (updates: Partial<ItemNode>) => {
      if (!selectedId || !node) return
      updateNode(selectedId as AnyNode['id'], updates)

      // Mark parent wall as dirty if item is attached to wall
      if (node.asset.attachTo === 'wall' && node.parentId) {
        requestAnimationFrame(() => {
          useScene.getState().dirtyNodes.add(node.parentId as AnyNode['id'])
        })
      }
    },
    [selectedId, node, updateNode],
  )

  const handleClose = useCallback(() => {
    setSelection({ selectedIds: [] })
  }, [setSelection])

  const handleMove = useCallback(() => {
    if (node) {
      sfxEmitter.emit('sfx:item-pick')
      setMovingNode(node)
      // Deselect so the panel closes
      setSelection({ selectedIds: [] })
    }
  }, [node, setMovingNode, setSelection])

  const handleDuplicate = useCallback(() => {
    if (!node) return
    sfxEmitter.emit('sfx:item-pick')
    // Create a proto node (not added to scene) as a carrier for asset/position info.
    // MoveItemContent detects metadata.isNew and uses draftNode.create() so ghost rendering works correctly.
    const proto = ItemNode.parse({
      position: [...node.position] as [number, number, number],
      rotation: [...node.rotation] as [number, number, number],
      name: node.name,
      asset: node.asset,
      parentId: node.parentId,
      side: node.side,
      metadata: { isNew: true },
    })
    setMovingNode(proto)
    setSelection({ selectedIds: [] })
  }, [node, setMovingNode, setSelection])

  const handleDelete = useCallback(() => {
    if (!selectedId) return
    sfxEmitter.emit('sfx:item-delete')
    deleteNode(selectedId as AnyNode['id'])
    setSelection({ selectedIds: [] })
  }, [selectedId, deleteNode, setSelection])

  // Only show if exactly one item is selected
  if (!node || node.type !== 'item' || selectedIds.length !== 1) return null

  return (
    <div className="pointer-events-auto fixed top-20 right-4 z-50 flex w-72 flex-col overflow-hidden rounded-lg border border-border bg-background/95 shadow-xl backdrop-blur-md">
      {/* Header */}
      <div className="flex items-center justify-between gap-2 border-b border-border/50 p-3 bg-white/50 dark:bg-transparent">
        <div className="flex items-center gap-2 min-w-0">
          <Image
            src={node.asset.thumbnail || '/icons/furniture.png'}
            alt=""
            width={16}
            height={16}
            className="shrink-0 object-contain"
          />
          <h2 className="font-semibold text-foreground text-sm truncate">
            {node.name || node.asset.name}
          </h2>
        </div>
        <button
          type="button"
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
            <label className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
              Position
            </label>
            <div className="grid grid-cols-3 gap-2">
              <NumberInput
                label="X"
                value={Math.round(node.position[0] * 100) / 100}
                onChange={(value) => {
                  handleUpdate({ position: [value, node.position[1], node.position[2]] })
                }}
                precision={2}
              />
              <NumberInput
                label="Y"
                value={Math.round(node.position[1] * 100) / 100}
                onChange={(value) => {
                  handleUpdate({ position: [node.position[0], value, node.position[2]] })
                }}
                precision={2}
              />
              <NumberInput
                label="Z"
                value={Math.round(node.position[2] * 100) / 100}
                onChange={(value) => {
                  handleUpdate({ position: [node.position[0], node.position[1], value] })
                }}
                precision={2}
              />
            </div>
          </div>

          {/* Rotation */}
          <div className="space-y-2">
            <label className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
              Rotation
            </label>
            <div className="flex items-center gap-2">
              <NumberInput
                label="Y"
                value={Math.round((node.rotation[1] * 180) / Math.PI)}
                onChange={(degrees) => {
                  const radians = (degrees * Math.PI) / 180
                  handleUpdate({ rotation: [node.rotation[0], radians, node.rotation[2]] })
                }}
                precision={0}
                className="flex-1"
              />
              <span className="text-muted-foreground text-xs shrink-0">°</span>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                className="flex-1 rounded border border-border px-2 py-1.5 text-xs hover:bg-accent cursor-pointer"
                onClick={() => {
                  sfxEmitter.emit('sfx:item-rotate')
                  const currentDegrees = (node.rotation[1] * 180) / Math.PI
                  const newDegrees = currentDegrees - 90
                  const radians = (newDegrees * Math.PI) / 180
                  handleUpdate({ rotation: [node.rotation[0], radians, node.rotation[2]] })
                }}
              >
                -90°
              </button>
              <button
                type="button"
                className="flex-1 rounded border border-border px-2 py-1.5 text-xs hover:bg-accent cursor-pointer"
                onClick={() => {
                  sfxEmitter.emit('sfx:item-rotate')
                  const currentDegrees = (node.rotation[1] * 180) / Math.PI
                  const newDegrees = currentDegrees + 90
                  const radians = (newDegrees * Math.PI) / 180
                  handleUpdate({ rotation: [node.rotation[0], radians, node.rotation[2]] })
                }}
              >
                +90°
              </button>
            </div>
          </div>

          {/* Scale */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
                Scale
              </label>
              <button
                type="button"
                className="rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground cursor-pointer"
                onClick={() => setUniformScale((v) => !v)}
                title={uniformScale ? 'Unlock axes' : 'Lock axes'}
              >
                {uniformScale ? <Link className="h-3.5 w-3.5" /> : <Link2Off className="h-3.5 w-3.5" />}
              </button>
            </div>
            {uniformScale ? (
              <NumberInput
                label="XYZ"
                value={Math.round(node.scale[0] * 100) / 100}
                onChange={(value) => {
                  const v = Math.max(0.01, value)
                  handleUpdate({ scale: [v, v, v] })
                }}
                precision={2}
                step={0.1}
              />
            ) : (
              <div className="grid grid-cols-3 gap-2">
                <NumberInput
                  label="X"
                  value={Math.round(node.scale[0] * 100) / 100}
                  onChange={(value) => {
                    handleUpdate({ scale: [Math.max(0.01, value), node.scale[1], node.scale[2]] })
                  }}
                  precision={2}
                  step={0.1}
                />
                <NumberInput
                  label="Y"
                  value={Math.round(node.scale[1] * 100) / 100}
                  onChange={(value) => {
                    handleUpdate({ scale: [node.scale[0], Math.max(0.01, value), node.scale[2]] })
                  }}
                  precision={2}
                  step={0.1}
                />
                <NumberInput
                  label="Z"
                  value={Math.round(node.scale[2] * 100) / 100}
                  onChange={(value) => {
                    handleUpdate({ scale: [node.scale[0], node.scale[1], Math.max(0.01, value)] })
                  }}
                  precision={2}
                  step={0.1}
                />
              </div>
            )}
          </div>

          {/* Dimensions (effective, read-only) */}
          <div className="space-y-2">
            <label className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
              Dimensions
            </label>
            <div className="rounded-lg border border-neutral-200/60 dark:border-border/50 bg-white/50 dark:bg-accent/30 shadow-[0_1px_2px_0px_rgba(0,0,0,0.05)] px-3 py-2 text-sm text-foreground">
              {(() => {
                const [w, h, d] = getScaledDimensions(node)
                return `${Math.round(w * 100) / 100}m × ${Math.round(h * 100) / 100}m × ${Math.round(d * 100) / 100}m`
              })()}
            </div>
          </div>
        </div>
      </div>

      {/* Action Buttons */}
      <div className="border-t border-border/50 p-3 bg-white/50 dark:bg-transparent">
        <div className="flex gap-2">
          <button
            type="button"
            className="flex-1 flex items-center justify-center gap-1.5 rounded-md border border-neutral-200/60 dark:border-border/50 bg-white dark:bg-background shadow-[0_1px_2px_0px_rgba(0,0,0,0.05)] px-2 py-1.5 text-xs font-medium text-foreground hover:bg-black/5 dark:hover:bg-white/10 transition-colors cursor-pointer"
            onClick={handleMove}
          >
            <Move className="h-3.5 w-3.5" />
            <span>Move</span>
          </button>
          <button
            type="button"
            className="flex-1 flex items-center justify-center gap-1.5 rounded-md border border-neutral-200/60 dark:border-border/50 bg-white dark:bg-background shadow-[0_1px_2px_0px_rgba(0,0,0,0.05)] px-2 py-1.5 text-xs font-medium text-foreground hover:bg-black/5 dark:hover:bg-white/10 transition-colors cursor-pointer"
            onClick={handleDuplicate}
          >
            <Copy className="h-3.5 w-3.5" />
            <span>Duplicate</span>
          </button>
          <button
            type="button"
            className="flex-1 flex items-center justify-center gap-1.5 rounded-md border border-neutral-200/60 dark:border-border/50 bg-white dark:bg-background shadow-[0_1px_2px_0px_rgba(0,0,0,0.05)] px-2 py-1.5 text-xs font-medium text-foreground hover:bg-black/5 dark:hover:bg-white/10 transition-colors cursor-pointer"
            onClick={handleDelete}
          >
            <Trash2 className="h-3.5 w-3.5" />
            <span>Delete</span>
          </button>
        </div>
      </div>
    </div>
  )
}

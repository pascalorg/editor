'use client'

import { type AnyNode, type ItemNode, useScene } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { Move, Trash2, X } from 'lucide-react'
import Image from 'next/image'
import { useCallback } from 'react'
import useEditor from '@/store/use-editor'
import { NumberInput } from '@/components/ui/primitives/number-input'

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

  const handleUpdate = useCallback(
    (updates: Partial<ItemNode>) => {
      if (!selectedId) return
      updateNode(selectedId as AnyNode['id'], updates)
    },
    [selectedId, updateNode],
  )

  const handleClose = useCallback(() => {
    setSelection({ selectedIds: [] })
  }, [setSelection])

  const handleMove = useCallback(() => {
    if (node) {
      setMovingNode(node)
      // Deselect so the panel closes
      setSelection({ selectedIds: [] })
    }
  }, [node, setMovingNode, setSelection])

  const handleDelete = useCallback(() => {
    if (!selectedId) return
    deleteNode(selectedId as AnyNode['id'])
    setSelection({ selectedIds: [] })
  }, [selectedId, deleteNode, setSelection])

  // Only show if exactly one item is selected
  if (!node || node.type !== 'item' || selectedIds.length !== 1) return null

  return (
    <div className="pointer-events-auto fixed top-20 right-4 z-50 flex w-72 flex-col overflow-hidden rounded-lg border border-border bg-background/95 shadow-xl backdrop-blur-md">
      {/* Header */}
      <div className="flex items-center justify-between gap-2 border-b p-3">
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

          {/* Dimensions (read-only) */}
          <div className="space-y-2">
            <label className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
              Dimensions
            </label>
            <div className="rounded border border-border bg-muted/50 px-3 py-2 text-sm">
              {node.asset.dimensions[0]}m × {node.asset.dimensions[1]}m × {node.asset.dimensions[2]}m
            </div>
          </div>
        </div>
      </div>

      {/* Action Buttons */}
      <div className="border-t p-3">
        <div className="flex gap-2">
          <button
            type="button"
            className="flex-1 flex items-center justify-center gap-2 rounded border border-border bg-primary px-4 py-2 text-primary-foreground hover:bg-primary/90 cursor-pointer"
            onClick={handleMove}
          >
            <Move className="h-4 w-4" />
            <span>Move</span>
          </button>
          <button
            type="button"
            className="flex-1 flex items-center justify-center gap-2 rounded border border-border bg-destructive px-4 py-2 text-destructive-foreground hover:bg-destructive/90 cursor-pointer"
            onClick={handleDelete}
          >
            <Trash2 className="h-4 w-4" />
            <span>Delete</span>
          </button>
        </div>
      </div>
    </div>
  )
}

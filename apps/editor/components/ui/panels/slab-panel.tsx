'use client'

import { type AnyNode, type SlabNode, useScene } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { Edit, Plus, Trash2, X } from 'lucide-react'
import Image from 'next/image'
import { useCallback, useEffect } from 'react'
import useEditor from '@/store/use-editor'
import { NumberInput } from '@/components/ui/primitives/number-input'

export function SlabPanel() {
  const selectedIds = useViewer((s) => s.selection.selectedIds)
  const setSelection = useViewer((s) => s.setSelection)
  const nodes = useScene((s) => s.nodes)
  const updateNode = useScene((s) => s.updateNode)
  const editingHoleIndex = useEditor((s) => s.editingSlabHoleIndex)
  const setEditingHoleIndex = useEditor((s) => s.setEditingSlabHoleIndex)

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
    setEditingHoleIndex(null)
  }, [setSelection, setEditingHoleIndex])

  // Clear hole editing state when slab is deselected
  useEffect(() => {
    if (!node) {
      setEditingHoleIndex(null)
    }
  }, [node, setEditingHoleIndex])

  const handleAddHole = useCallback(() => {
    if (!node) return

    // Calculate centroid of the slab polygon
    const polygon = node.polygon
    let cx = 0
    let cz = 0
    for (const [x, z] of polygon) {
      cx += x
      cz += z
    }
    cx /= polygon.length
    cz /= polygon.length

    // Create a default small rectangular hole centered at the slab's centroid
    const holeSize = 0.5
    const newHole: Array<[number, number]> = [
      [cx - holeSize, cz - holeSize],
      [cx + holeSize, cz - holeSize],
      [cx + holeSize, cz + holeSize],
      [cx - holeSize, cz + holeSize],
    ]
    const currentHoles = node?.holes || []
    handleUpdate({ holes: [...currentHoles, newHole] })
    // Enter edit mode for the new hole
    setEditingHoleIndex(currentHoles.length)
  }, [node, handleUpdate, setEditingHoleIndex])

  const handleEditHole = useCallback(
    (index: number) => {
      setEditingHoleIndex(index)
    },
    [setEditingHoleIndex],
  )

  const handleDeleteHole = useCallback(
    (index: number) => {
      const currentHoles = node?.holes || []
      const newHoles = currentHoles.filter((_, i) => i !== index)
      handleUpdate({ holes: newHoles })
      if (editingHoleIndex === index) {
        setEditingHoleIndex(null)
      }
    },
    [node?.holes, handleUpdate, editingHoleIndex],
  )

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
              <NumberInput
                label="Elevation"
                value={Math.round(node.elevation * 1000) / 1000}
                onChange={(value) => {
                  handleUpdate({ elevation: value })
                }}
                precision={3}
                className="flex-1"
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

          {/* Holes */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
                Holes
              </label>
              {editingHoleIndex !== null ? (
                <button
                  type="button"
                  className="flex items-center gap-1 rounded border border-green-500 bg-green-500/10 px-2 py-1 text-xs text-green-600 hover:bg-green-500/20 cursor-pointer"
                  onClick={() => setEditingHoleIndex(null)}
                >
                  <span>Done Editing</span>
                </button>
              ) : (
                <button
                  type="button"
                  className="flex items-center gap-1 rounded border border-border px-2 py-1 text-xs hover:bg-accent cursor-pointer"
                  onClick={handleAddHole}
                >
                  <Plus className="h-3 w-3" />
                  <span>Add Hole</span>
                </button>
              )}
            </div>
            {node.holes && node.holes.length > 0 ? (
              <div className="space-y-2">
                {node.holes.map((hole, index) => {
                  const holeArea = calculateArea(hole)
                  const isEditing = editingHoleIndex === index
                  return (
                    <div
                      key={index}
                      className={`flex items-center justify-between rounded border px-3 py-2 ${
                        isEditing
                          ? 'border-green-500 bg-green-500/10'
                          : 'border-border bg-muted/30'
                      }`}
                    >
                      <div className="flex-1 min-w-0">
                        <p className={`text-sm font-medium ${isEditing ? 'text-green-600' : ''}`}>
                          Hole {index + 1} {isEditing && '(Editing)'}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {holeArea.toFixed(2)} m² · {hole.length} vertices
                        </p>
                      </div>
                      <div className="flex items-center gap-1">
                        {!isEditing && (
                          <>
                            <button
                              type="button"
                              className="rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground cursor-pointer"
                              onClick={() => handleEditHole(index)}
                              aria-label="Edit hole"
                            >
                              <Edit className="h-3.5 w-3.5" />
                            </button>
                            <button
                              type="button"
                              className="rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground cursor-pointer"
                              onClick={() => handleDeleteHole(index)}
                              aria-label="Delete hole"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground italic">
                No holes. Click "Add Hole" to create one.
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

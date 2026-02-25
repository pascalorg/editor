'use client'

import { type AnyNode, type CeilingNode, useScene } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { Edit, Plus, Trash2, X } from 'lucide-react'
import Image from 'next/image'
import { useCallback, useEffect } from 'react'
import useEditor from '@/store/use-editor'
import { NumberInput } from '@/components/ui/primitives/number-input'

export function CeilingPanel() {
  const selectedIds = useViewer((s) => s.selection.selectedIds)
  const setSelection = useViewer((s) => s.setSelection)
  const nodes = useScene((s) => s.nodes)
  const updateNode = useScene((s) => s.updateNode)
  const editingHole = useEditor((s) => s.editingHole)
  const setEditingHole = useEditor((s) => s.setEditingHole)

  // Get the first selected node if it's a ceiling
  const selectedId = selectedIds[0]
  const node = selectedId
    ? (nodes[selectedId as AnyNode['id']] as CeilingNode | undefined)
    : undefined

  const handleUpdate = useCallback(
    (updates: Partial<CeilingNode>) => {
      if (!selectedId) return
      updateNode(selectedId as AnyNode['id'], updates)
    },
    [selectedId, updateNode],
  )

  const handleClose = useCallback(() => {
    setSelection({ selectedIds: [] })
    setEditingHole(null)
  }, [setSelection, setEditingHole])

  // Clear hole editing state when ceiling is deselected
  useEffect(() => {
    if (!node) {
      setEditingHole(null)
    }
  }, [node, setEditingHole])

  // Clear hole editing state on unmount
  useEffect(() => {
    return () => {
      setEditingHole(null)
    }
  }, [setEditingHole])

  const handleAddHole = useCallback(() => {
    if (!node || !selectedId) return

    // Calculate centroid of the ceiling polygon
    const polygon = node.polygon
    let cx = 0
    let cz = 0
    for (const [x, z] of polygon) {
      cx += x
      cz += z
    }
    cx /= polygon.length
    cz /= polygon.length

    // Create a default small rectangular hole centered at the ceiling's centroid
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
    setEditingHole({ nodeId: selectedId, holeIndex: currentHoles.length })
  }, [node, selectedId, handleUpdate, setEditingHole])

  const handleEditHole = useCallback(
    (index: number) => {
      if (!selectedId) return
      setEditingHole({ nodeId: selectedId, holeIndex: index })
    },
    [selectedId, setEditingHole],
  )

  const handleDeleteHole = useCallback(
    (index: number) => {
      if (!selectedId) return
      const currentHoles = node?.holes || []
      const newHoles = currentHoles.filter((_, i) => i !== index)
      handleUpdate({ holes: newHoles })
      if (editingHole?.nodeId === selectedId && editingHole?.holeIndex === index) {
        setEditingHole(null)
      }
    },
    [selectedId, node?.holes, handleUpdate, editingHole, setEditingHole],
  )

  // Only show if exactly one ceiling is selected
  if (!node || node.type !== 'ceiling' || selectedIds.length !== 1) return null

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
      <div className="flex items-center justify-between gap-2 border-b border-border/50 p-3 bg-white/50 dark:bg-transparent">
        <div className="flex items-center gap-2 min-w-0">
          <Image src="/icons/ceiling.png" alt="" width={16} height={16} className="shrink-0 object-contain" />
          <h2 className="font-semibold font-barlow text-foreground text-sm truncate">
            {node.name || `Ceiling (${area.toFixed(1)}m²)`}
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
          {/* Height */}
          <div className="space-y-2">
            <label className="font-medium font-barlow text-muted-foreground text-xs uppercase tracking-wide">
              Height
            </label>
            <div className="flex items-center gap-2">
              <NumberInput
                label="Height"
                value={Math.round(node.height * 1000) / 1000}
                onChange={(value) => {
                  handleUpdate({ height: value })
                }}
                precision={3}
                className="flex-1"
              />
              <span className="text-muted-foreground text-xs shrink-0">m</span>
            </div>
            <p className="text-xs text-muted-foreground">
              Height from the floor where the ceiling is positioned
            </p>
          </div>

          {/* Quick preset buttons */}
          <div className="space-y-2">
            <label className="font-medium font-barlow text-muted-foreground text-xs uppercase tracking-wide">
              Presets
            </label>
            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                className="rounded-md border border-neutral-200/60 dark:border-border/50 bg-white dark:bg-background shadow-[0_1px_2px_0px_rgba(0,0,0,0.05)] px-2 py-1.5 text-xs font-medium font-barlow text-foreground hover:bg-black/5 dark:hover:bg-white/10 transition-colors cursor-pointer"
                onClick={() => handleUpdate({ height: 2.4 })}
              >
                Low (2.4m)
              </button>
              <button
                type="button"
                className="rounded-md border border-neutral-200/60 dark:border-border/50 bg-white dark:bg-background shadow-[0_1px_2px_0px_rgba(0,0,0,0.05)] px-2 py-1.5 text-xs font-medium font-barlow text-foreground hover:bg-black/5 dark:hover:bg-white/10 transition-colors cursor-pointer"
                onClick={() => handleUpdate({ height: 2.5 })}
              >
                Standard (2.5m)
              </button>
              <button
                type="button"
                className="rounded-md border border-neutral-200/60 dark:border-border/50 bg-white dark:bg-background shadow-[0_1px_2px_0px_rgba(0,0,0,0.05)] px-2 py-1.5 text-xs font-medium font-barlow text-foreground hover:bg-black/5 dark:hover:bg-white/10 transition-colors cursor-pointer"
                onClick={() => handleUpdate({ height: 3.0 })}
              >
                High (3m)
              </button>
            </div>
          </div>

          {/* Area info */}
          <div className="space-y-2">
            <label className="font-medium font-barlow text-muted-foreground text-xs uppercase tracking-wide">
              Area
            </label>
            <div className="rounded-lg border border-neutral-200/60 dark:border-border/50 bg-white/50 dark:bg-accent/30 shadow-[0_1px_2px_0px_rgba(0,0,0,0.05)] px-3 py-2 text-sm text-foreground">
              {area.toFixed(2)} m²
            </div>
          </div>

          {/* Holes */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="font-medium font-barlow text-muted-foreground text-xs uppercase tracking-wide">
                Holes
              </label>
              {editingHole?.nodeId === selectedId ? (
                <button
                  type="button"
                  className="flex items-center gap-1 rounded-md border border-green-500 bg-green-500/10 shadow-[0_1px_2px_0px_rgba(0,0,0,0.05)] px-2 py-1.5 text-xs font-medium text-green-600 hover:bg-green-500/20 transition-colors cursor-pointer"
                  onClick={() => setEditingHole(null)}
                >
                  <span>Done Editing</span>
                </button>
              ) : (
                <button
                  type="button"
                  className="flex items-center gap-1 rounded-md border border-neutral-200/60 dark:border-border/50 bg-white dark:bg-background shadow-[0_1px_2px_0px_rgba(0,0,0,0.05)] px-2 py-1.5 text-xs font-medium font-barlow text-foreground hover:bg-black/5 dark:hover:bg-white/10 transition-colors cursor-pointer"
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
                  const isEditing = editingHole?.nodeId === selectedId && editingHole?.holeIndex === index
                  return (
                    <div
                      key={index}
                      className={`flex items-center justify-between rounded-lg border px-3 py-2 shadow-[0_1px_2px_0px_rgba(0,0,0,0.05)] transition-colors ${
                        isEditing
                          ? 'border-green-500 bg-green-500/10 ring-1 ring-green-500/20'
                          : 'border-neutral-200/60 dark:border-border/50 bg-white/50 dark:bg-accent/30'
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

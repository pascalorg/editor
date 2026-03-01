'use client'

import { type AnyNode, type SlabNode, useScene } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { Edit, Plus, Trash2 } from 'lucide-react'
import { useCallback, useEffect } from 'react'
import useEditor from '@/store/use-editor'

import { PanelWrapper } from './panel-wrapper'
import { PanelSection } from '../controls/panel-section'
import { SliderControl } from '../controls/slider-control'
import { ActionButton, ActionGroup } from '../controls/action-button'

export function SlabPanel() {
  const selectedIds = useViewer((s) => s.selection.selectedIds)
  const setSelection = useViewer((s) => s.setSelection)
  const nodes = useScene((s) => s.nodes)
  const updateNode = useScene((s) => s.updateNode)
  const editingHole = useEditor((s) => s.editingHole)
  const setEditingHole = useEditor((s) => s.setEditingHole)

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
    setEditingHole(null)
  }, [setSelection, setEditingHole])

  useEffect(() => {
    if (!node) {
      setEditingHole(null)
    }
  }, [node, setEditingHole])

  useEffect(() => {
    return () => {
      setEditingHole(null)
    }
  }, [setEditingHole])

  const handleAddHole = useCallback(() => {
    if (!node || !selectedId) return

    const polygon = node.polygon
    let cx = 0
    let cz = 0
    for (const [x, z] of polygon) {
      cx += x
      cz += z
    }
    cx /= polygon.length
    cz /= polygon.length

    const holeSize = 0.5
    const newHole: Array<[number, number]> = [
      [cx - holeSize, cz - holeSize],
      [cx + holeSize, cz - holeSize],
      [cx + holeSize, cz + holeSize],
      [cx - holeSize, cz + holeSize],
    ]
    const currentHoles = node?.holes || []
    handleUpdate({ holes: [...currentHoles, newHole] })
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

  if (!node || node.type !== 'slab' || selectedIds.length !== 1) return null

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
    <PanelWrapper
      title={node.name || "Slab"}
      icon="/icons/floor.png"
      onClose={handleClose}
      width={320}
    >
      <PanelSection title="Elevation">
        <SliderControl
          label="Height"
          value={Math.round(node.elevation * 1000) / 1000}
          onChange={(v) => handleUpdate({ elevation: v })}
          min={-1}
          max={1}
          precision={3}
          step={0.01}
          unit="m"
        />
        
        <div className="mt-2 grid grid-cols-2 gap-1.5 px-1 pb-1">
          <ActionButton label="Sunken (-15cm)" onClick={() => handleUpdate({ elevation: -0.15 })} />
          <ActionButton label="Ground (0m)" onClick={() => handleUpdate({ elevation: 0 })} />
          <ActionButton label="Raised (+5cm)" onClick={() => handleUpdate({ elevation: 0.05 })} />
          <ActionButton label="Step (+15cm)" onClick={() => handleUpdate({ elevation: 0.15 })} />
        </div>
      </PanelSection>

      <PanelSection title="Info">
        <div className="flex items-center justify-between px-2 py-1 text-sm text-muted-foreground">
          <span>Area</span>
          <span className="font-mono text-white">{area.toFixed(2)} m²</span>
        </div>
      </PanelSection>

      <PanelSection title="Holes">
        {node.holes && node.holes.length > 0 ? (
          <div className="flex flex-col gap-1 pb-2">
            {node.holes.map((hole, index) => {
              const holeArea = calculateArea(hole)
              const isEditing = editingHole?.nodeId === selectedId && editingHole?.holeIndex === index
              return (
                <div
                  key={index}
                  className={`flex items-center justify-between rounded-lg border p-2 transition-colors ${
                    isEditing
                      ? 'border-primary/50 bg-primary/10'
                      : 'border-transparent hover:bg-accent/30'
                  }`}
                >
                  <div className="flex-1 min-w-0">
                    <p className={`text-xs font-medium ${isEditing ? 'text-primary' : 'text-white'}`}>
                      Hole {index + 1} {isEditing && '(Editing)'}
                    </p>
                    <p className="text-[10px] text-muted-foreground">
                      {holeArea.toFixed(2)} m² · {hole.length} pts
                    </p>
                  </div>
                  <div className="flex items-center gap-1">
                    {isEditing ? (
                      <ActionButton 
                        label="Done" 
                        onClick={() => setEditingHole(null)} 
                        className="h-7 bg-primary text-primary-foreground hover:bg-primary/90"
                      />
                    ) : (
                      <>
                        <button
                          type="button"
                          className="flex h-7 w-7 items-center justify-center rounded-md bg-[#2C2C2E] text-muted-foreground hover:bg-[#3e3e3e] hover:text-foreground"
                          onClick={() => handleEditHole(index)}
                        >
                          <Edit className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          className="flex h-7 w-7 items-center justify-center rounded-md bg-red-500/10 text-red-400 hover:bg-red-500/20 hover:text-red-300"
                          onClick={() => handleDeleteHole(index)}
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
          <div className="px-2 py-3 text-center text-xs text-muted-foreground">
            No holes
          </div>
        )}
        
        <div className="px-1 pt-1 pb-1">
          <ActionButton 
            icon={<Plus className="h-3.5 w-3.5" />} 
            label="Add Hole" 
            onClick={handleAddHole} 
            className="w-full"
            disabled={editingHole?.nodeId === selectedId}
          />
        </div>
      </PanelSection>
    </PanelWrapper>
  )
}

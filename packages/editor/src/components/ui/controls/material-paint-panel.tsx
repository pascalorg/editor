'use client'

import { useScene } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { useEffect } from 'react'
import { resolvePaintTargetFromSelection } from './../../../lib/material-paint'
import useEditor from './../../../store/use-editor'
import { MaterialPicker } from './material-picker'

/**
 * Material picker for paint mode. Embedders render this wherever paint controls
 * belong (the community editor places it in the Build sidebar while paint mode
 * is active). It owns the paint-target/material wiring so the host only needs
 * to mount it; it fills its container's width.
 */
export function MaterialPaintPanel() {
  const activePaintMaterial = useEditor((state) => state.activePaintMaterial)
  const activePaintTarget = useEditor((state) => state.activePaintTarget)
  const setActivePaintMaterial = useEditor((state) => state.setActivePaintMaterial)
  const setActivePaintTarget = useEditor((state) => state.setActivePaintTarget)
  const selectedIds = useViewer((state) => state.selection.selectedIds)
  const nodes = useScene((state) => state.nodes)
  const selectedId = selectedIds.length === 1 ? (selectedIds[0] ?? null) : null

  useEffect(() => {
    const selectedPaintTarget = resolvePaintTargetFromSelection({ nodes, selectedId })
    if (selectedPaintTarget) {
      setActivePaintTarget(selectedPaintTarget)
    }
  }, [nodes, selectedId, setActivePaintTarget])

  return (
    <div className="w-full">
      <MaterialPicker
        onChange={(material) => {
          setActivePaintMaterial({ material, sourceTarget: activePaintTarget })
        }}
        onSelectMaterialPreset={(materialPreset) => {
          setActivePaintMaterial({ materialPreset, sourceTarget: activePaintTarget })
        }}
        selectedMaterialPreset={activePaintMaterial?.materialPreset}
        value={activePaintMaterial?.material}
      />
    </div>
  )
}

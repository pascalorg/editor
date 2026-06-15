'use client'

import { type AnyNodeId, useScene } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { Eraser, RotateCcw } from 'lucide-react'
import { useEffect } from 'react'
import {
  buildResetSurfaceMaterialUpdates,
  resolvePaintTargetFromSelection,
} from './../../../lib/material-paint'
import useEditor from './../../../store/use-editor'
import { Button } from '../primitives/button'
import { MaterialPicker } from './material-picker'
import { PanelSection } from './panel-section'
import { SceneMaterialList } from './scene-material-list'

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
  const paintEraser = useEditor((state) => state.paintEraser)
  const setPaintEraser = useEditor((state) => state.setPaintEraser)
  const selectedIds = useViewer((state) => state.selection.selectedIds)
  const nodes = useScene((state) => state.nodes)
  const materialCount = useScene((state) => Object.keys(state.materials).length)
  const selectedId = selectedIds.length === 1 ? (selectedIds[0] ?? null) : null
  const selectedNode = selectedId ? nodes[selectedId as AnyNodeId] : null
  const canResetSelection =
    selectedNode != null && resolvePaintTargetFromSelection({ nodes, selectedId }) != null

  useEffect(() => {
    const selectedPaintTarget = resolvePaintTargetFromSelection({ nodes, selectedId })
    if (selectedPaintTarget) {
      setActivePaintTarget(selectedPaintTarget)
    }
  }, [nodes, selectedId, setActivePaintTarget])

  const resetSelection = () => {
    if (!selectedNode) return
    useScene.getState().updateNodes(buildResetSurfaceMaterialUpdates(nodes, selectedNode))
  }

  return (
    <div className="w-full space-y-2">
      <div className="flex items-center gap-2">
        <Button
          aria-pressed={paintEraser}
          className="flex-1"
          onClick={() => setPaintEraser(!paintEraser)}
          size="sm"
          variant={paintEraser ? 'default' : 'outline'}
        >
          <Eraser />
          Erase
        </Button>
        <Button
          className="flex-1"
          disabled={!canResetSelection}
          onClick={resetSelection}
          size="sm"
          variant="outline"
        >
          <RotateCcw />
          Reset all
        </Button>
      </div>
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
      {materialCount > 0 ? (
        <PanelSection title="Scene materials">
          <SceneMaterialList />
        </PanelSection>
      ) : null}
    </div>
  )
}

'use client'

import { type AnyNodeId, useScene } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { useEffect } from 'react'
import useEditor from '../store/use-editor'
import { buildResetSurfaceMaterialUpdates, resolvePaintTargetFromSelection } from './material-paint'

export function useMaterialPaintPanelModel(enabled = true) {
  const activePaintMaterial = useEditor((state) => state.activePaintMaterial)
  const activePaintTarget = useEditor((state) => state.activePaintTarget)
  const setActivePaintMaterial = useEditor((state) => state.armMaterialPaint)
  const setActivePaintTarget = useEditor((state) => state.setActivePaintTarget)
  const paintEraser = useEditor((state) => state.paintEraser)
  const setPaintEraser = useEditor((state) => state.setPaintEraser)
  const selectedId = useViewer((state) =>
    state.selection.selectedIds.length === 1 ? (state.selection.selectedIds[0] ?? null) : null,
  )
  const paintTarget = useScene((state) =>
    resolvePaintTargetFromSelection({ nodes: state.nodes, selectedId }),
  )
  const canResetSelection = paintTarget !== null
  useEffect(() => {
    if (enabled && paintTarget) setActivePaintTarget(paintTarget)
  }, [enabled, paintTarget, setActivePaintTarget])
  const resetSelection = () => {
    const scene = useScene.getState()
    const node = selectedId ? scene.nodes[selectedId as AnyNodeId] : undefined
    if (node) scene.updateNodes(buildResetSurfaceMaterialUpdates(scene.nodes, node))
  }
  const selectMaterial = (materialPreset: string) =>
    setActivePaintMaterial({ materialPreset, sourceTarget: useEditor.getState().activePaintTarget })
  return {
    activePaintMaterial,
    activePaintTarget,
    setActivePaintMaterial,
    paintEraser,
    setPaintEraser,
    canResetSelection,
    resetSelection,
    selectMaterial,
  }
}

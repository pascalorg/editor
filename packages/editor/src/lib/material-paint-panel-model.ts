'use client'

import {
  type AnyNodeId,
  generateSceneMaterialId,
  toSceneMaterialRef,
  useScene,
} from '@pascal-app/core'
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
  const selectedIds = useViewer((state) => state.selection.selectedIds)
  const nodes = useScene((state) => state.nodes)
  const materials = useScene((state) => state.materials)
  const selectedId = selectedIds.length === 1 ? (selectedIds[0] ?? null) : null
  const selectedNode = selectedId ? nodes[selectedId as AnyNodeId] : undefined
  const canResetSelection =
    !!selectedNode && !!resolvePaintTargetFromSelection({ nodes, selectedId })
  useEffect(() => {
    if (!enabled) return
    const target = resolvePaintTargetFromSelection({ nodes, selectedId })
    if (target) setActivePaintTarget(target)
  }, [enabled, nodes, selectedId, setActivePaintTarget])
  const resetSelection = () => {
    const scene = useScene.getState()
    const node = selectedId ? scene.nodes[selectedId as AnyNodeId] : undefined
    if (node) scene.updateNodes(buildResetSurfaceMaterialUpdates(scene.nodes, node))
  }
  const createCustomMaterial = () => {
    const scene = useScene.getState()
    const id = generateSceneMaterialId()
    scene.addSceneMaterial({
      id,
      name: `Material ${Object.keys(scene.materials).length + 1}`,
      material: {
        preset: 'custom',
        properties: {
          color: '#ffffff',
          roughness: 0.5,
          metalness: 0,
          opacity: 1,
          transparent: false,
          side: 'front',
        },
      },
    })
    setActivePaintMaterial({
      materialPreset: toSceneMaterialRef(id),
      sourceTarget: useEditor.getState().activePaintTarget,
    })
    return id
  }
  const selectMaterial = (materialPreset: string) =>
    setActivePaintMaterial({ materialPreset, sourceTarget: useEditor.getState().activePaintTarget })
  return {
    activePaintMaterial,
    activePaintTarget,
    setActivePaintMaterial,
    paintEraser,
    setPaintEraser,
    materials,
    materialCount: Object.keys(materials).length,
    canResetSelection,
    resetSelection,
    createCustomMaterial,
    selectMaterial,
  }
}

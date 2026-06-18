'use client'

import {
  type AnyNodeId,
  generateSceneMaterialId,
  type SceneMaterialId,
  toSceneMaterialRef,
  useScene,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { Eraser, Plus, RotateCcw } from 'lucide-react'
import { useEffect, useState } from 'react'
import {
  buildResetSurfaceMaterialUpdates,
  resolvePaintTargetFromSelection,
} from './../../../lib/material-paint'
import useEditor from './../../../store/use-editor'
import { Button } from '../primitives/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '../primitives/tooltip'
import { MaterialPicker } from './material-picker'
import { SceneMaterialList } from './scene-material-list'

/**
 * Material picker for paint mode. Embedders render this wherever paint controls
 * belong (the community editor places it in the Build sidebar while paint mode
 * is active). It fills its container's height and lays out as three bands: a
 * fixed control/category header, a single scrolling catalog grid, and a fixed
 * scene-material footer (always visible, with a `+` to add a custom material).
 */
export function MaterialPaintPanel() {
  const activePaintMaterial = useEditor((state) => state.activePaintMaterial)
  const activePaintTarget = useEditor((state) => state.activePaintTarget)
  const setActivePaintMaterial = useEditor((state) => state.setActivePaintMaterial)
  const setActivePaintTarget = useEditor((state) => state.setActivePaintTarget)
  const paintEraser = useEditor((state) => state.paintEraser)
  const setPaintEraser = useEditor((state) => state.setPaintEraser)
  // Id of a just-created scene material whose inline editor should open on mount.
  const [autoEditMaterialId, setAutoEditMaterialId] = useState<SceneMaterialId | null>(null)
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

  // Create a blank custom scene material, select it as the brush (`scene:` ref so
  // edits propagate), and open its inline editor. Available from any category.
  const createCustomMaterial = () => {
    const id = generateSceneMaterialId()
    const count = Object.keys(useScene.getState().materials).length
    useScene.getState().addSceneMaterial({
      id,
      name: `Material ${count + 1}`,
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
    setActivePaintMaterial({ materialPreset: toSceneMaterialRef(id), sourceTarget: activePaintTarget })
    setAutoEditMaterialId(id)
  }

  return (
    <div className="flex h-full min-h-0 w-full flex-col">
      {/* Fixed: eraser / reset. */}
      <div className="flex shrink-0 items-center gap-2 pb-2">
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

      {/* Scrolls: category tabs (fixed inside) + catalog grid (the scroll). */}
      <div className="min-h-0 flex-1">
        <MaterialPicker
          onSelectMaterialPreset={(materialPreset) => {
            setActivePaintMaterial({ materialPreset, sourceTarget: activePaintTarget })
          }}
          selectedMaterialPreset={activePaintMaterial?.materialPreset}
        />
      </div>

      {/* Fixed footer: scene materials, always visible, with a `+` to add one. */}
      <div className="mt-2 shrink-0 space-y-1.5 border-border/60 border-t pt-2">
        <div className="flex items-center justify-between">
          <span className="font-medium text-muted-foreground text-xs uppercase tracking-[0.12em]">
            Scene materials
          </span>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                aria-label="Add material"
                onClick={createCustomMaterial}
                size="icon-sm"
                type="button"
                variant="outline"
              >
                <Plus />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Add material</TooltipContent>
          </Tooltip>
        </div>
        <div className="subtle-scrollbar max-h-56 overflow-y-auto">
          {materialCount > 0 ? (
            <SceneMaterialList autoEditId={autoEditMaterialId} />
          ) : (
            <p className="px-0.5 py-1 text-muted-foreground text-xs">
              No custom materials yet — add one with +.
            </p>
          )}
        </div>
      </div>
    </div>
  )
}

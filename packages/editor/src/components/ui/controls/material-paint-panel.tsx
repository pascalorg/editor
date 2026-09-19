'use client'

import { type SceneMaterialId } from '@pascal-app/core'
import { Eraser, Plus, RotateCcw } from 'lucide-react'
import { useState } from 'react'
import { useMaterialPaintPanelModel } from '../../../lib/material-paint-panel-model'
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
export type MaterialPaintPanelProps = {
  /** When provided, the catalog grid leads with a "New material" tile that invokes it. */
  onCreateMaterialRequest?: () => void
}

export function MaterialPaintPanel({ onCreateMaterialRequest }: MaterialPaintPanelProps) {
  const { activePaintMaterial, paintEraser, setPaintEraser, canResetSelection, resetSelection, materialCount, selectMaterial, createCustomMaterial: createMaterial } = useMaterialPaintPanelModel()
  const [autoEditMaterialId, setAutoEditMaterialId] = useState<SceneMaterialId | null>(null)
  const createCustomMaterial = () => setAutoEditMaterialId(createMaterial())

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
      {/* A stable hook for host-app onboarding to point at. Static, and read
          only from outside: nothing here depends on it. */}
      <div className="min-h-0 flex-1" data-guide-target="paint-material">
        <MaterialPicker
          onCreateMaterialRequest={onCreateMaterialRequest}
          onSelectMaterialPreset={selectMaterial}
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

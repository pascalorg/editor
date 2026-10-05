'use client'

import { Eraser, RotateCcw } from 'lucide-react'
import { useMaterialPaintPanelModel } from '../../../lib/material-paint-panel-model'
import { Button } from '../primitives/button'
import { MaterialPicker } from './material-picker'

/**
 * Material picker for paint mode. Embedders render this wherever paint controls
 * belong (the community editor places it in the Build sidebar while paint mode
 * is active). It fills its container's height with paint controls and a
 * scrolling material catalog.
 */
export type MaterialPaintPanelProps = {
  /** When provided, the catalog grid leads with a "New material" tile that invokes it. */
  onCreateMaterialRequest?: () => void
}

export function MaterialPaintPanel({ onCreateMaterialRequest }: MaterialPaintPanelProps) {
  const { activePaintMaterial, paintEraser, setPaintEraser, canResetSelection, resetSelection, selectMaterial } = useMaterialPaintPanelModel()

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
    </div>
  )
}

'use client'

import { MaterialPaintPanel, triggerSFX, useEditor } from '@pascal-app/editor'
import Image from 'next/image'
import { useCallback, useEffect, useRef } from 'react'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/toolbar-tooltip'
import { cn } from '@/lib/utils'

/**
 * Raw structure-tool kinds the Build tab can activate. These map 1:1 to the
 * editor's `StructureTool` ids.
 */
type BuildToolKind =
  | 'wall'
  | 'fence'
  | 'slab'
  | 'ceiling'
  | 'roof'
  | 'stair'
  | 'elevator'
  | 'door'
  | 'window'
  | 'column'
  | 'shelf'
  | 'spawn'
  | 'duct-segment'
  | 'duct-fitting'
  | 'duct-terminal'
  | 'hvac-equipment'

type BuildType = {
  /** Selection id — equals `kind` for tool types, `'painting'` for paint mode. */
  id: string
  label: string
  iconSrc: string
  /** Present for structure-tool types (absent for the paint mode). */
  kind?: BuildToolKind
  /** Non-placement special mode. */
  mode?: 'material-paint'
}

// Same icons + ordering as the community Build sidebar, minus presets.
const BUILD_TYPES: BuildType[] = [
  { id: 'wall', label: 'Wall', iconSrc: '/icons/wall.png', kind: 'wall' },
  { id: 'fence', label: 'Fence', iconSrc: '/icons/fence.png', kind: 'fence' },
  { id: 'slab', label: 'Slab', iconSrc: '/icons/floor.png', kind: 'slab' },
  { id: 'ceiling', label: 'Ceiling', iconSrc: '/icons/ceiling.png', kind: 'ceiling' },
  { id: 'roof', label: 'Roof', iconSrc: '/icons/roof.png', kind: 'roof' },
  { id: 'stair', label: 'Stairs', iconSrc: '/icons/stairs.png', kind: 'stair' },
  { id: 'elevator', label: 'Elevator', iconSrc: '/icons/elevator.png', kind: 'elevator' },
  { id: 'door', label: 'Door', iconSrc: '/icons/door.png', kind: 'door' },
  { id: 'window', label: 'Window', iconSrc: '/icons/window.png', kind: 'window' },
  { id: 'column', label: 'Column', iconSrc: '/icons/column.png', kind: 'column' },
  { id: 'shelf', label: 'Shelf', iconSrc: '/icons/shelf.png', kind: 'shelf' },
  { id: 'spawn', label: 'Spawn Point', iconSrc: '/icons/spawn-point.png', kind: 'spawn' },
  { id: 'duct-segment', label: 'Duct', iconSrc: '/icons/wall.png', kind: 'duct-segment' },
  { id: 'duct-fitting', label: 'Duct Fitting', iconSrc: '/icons/column.png', kind: 'duct-fitting' },
  { id: 'duct-terminal', label: 'Register', iconSrc: '/icons/window.png', kind: 'duct-terminal' },
  { id: 'hvac-equipment', label: 'HVAC Unit', iconSrc: '/icons/elevator.png', kind: 'hvac-equipment' },
  { id: 'painting', label: 'Painting', iconSrc: '/icons/paint.png', mode: 'material-paint' },
]

/**
 * Activate a raw structure draw/cursor tool. Mirrors the editor's own
 * structure-tool activation (`setPhase`/`setStructureLayer`/`setMode`/`setTool`).
 */
function activateBuildTool(kind: BuildToolKind): void {
  const ed = useEditor.getState()
  ed.setPhase('structure')
  ed.setStructureLayer('elements')
  ed.setCatalogCategory(null)
  ed.setToolDefaults(kind, null)
  ed.setMode('build')
  ed.setTool(kind)
}

/** Enter material-paint mode — the Build tab's "Painting" category. */
function activatePaintMode(): void {
  const ed = useEditor.getState()
  ed.setPhase('structure')
  ed.setStructureLayer('elements')
  ed.setMode('material-paint')
}

/**
 * Build tab for the open-source standalone editor — a preset-less replica of
 * the community Build sidebar. Clicking a type activates its raw tool, drawn
 * with the kind's own `def.defaults()`. The "Painting" type swaps in the
 * material-paint panel.
 */
export function BuildTab() {
  const activeTool = useEditor((s) => s.tool)
  const mode = useEditor((s) => s.mode)

  const isTypeActive = (type: BuildType) =>
    type.mode === 'material-paint'
      ? mode === 'material-paint'
      : mode === 'build' && activeTool === type.kind

  const handleTypeClick = useCallback((type: BuildType) => {
    if (type.mode === 'material-paint') {
      activatePaintMode()
    } else if (type.kind) {
      activateBuildTool(type.kind)
    }
  }, [])

  // On open, land on the first build tool — parity with the community Build
  // sidebar, so switching to Build immediately arms a usable tool.
  const didInitRef = useRef(false)
  useEffect(() => {
    if (didInitRef.current) return
    didInitRef.current = true
    const firstType = BUILD_TYPES.find((t) => t.kind)
    if (firstType) handleTypeClick(firstType)
  }, [handleTypeClick])

  return (
    <div className="flex h-full flex-col gap-3 p-3">
      <TooltipProvider delayDuration={0} disableHoverableContent>
        <div
          className="grid gap-1.5"
          style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(56px, 1fr))' }}
        >
          {BUILD_TYPES.map((type) => {
            const active = isTypeActive(type)
            return (
              <Tooltip key={type.id}>
                <TooltipTrigger asChild>
                  <button
                    className={cn(
                      'group relative flex aspect-square items-center justify-center rounded-xl p-1 transition-all duration-200',
                      active
                        ? 'bg-primary/10 ring-1 ring-primary/50'
                        : 'bg-muted/40 opacity-70 grayscale hover:bg-muted hover:opacity-100 hover:grayscale-0',
                    )}
                    onClick={() => {
                      triggerSFX('sfx:menu-click')
                      handleTypeClick(type)
                    }}
                    onMouseEnter={() => triggerSFX('sfx:menu-hover')}
                    type="button"
                  >
                    <Image
                      alt={type.label}
                      className="size-full object-contain transition-transform duration-200 group-hover:scale-110"
                      height={48}
                      src={type.iconSrc}
                      width={48}
                    />
                  </button>
                </TooltipTrigger>
                <TooltipContent className="pointer-events-none" side="top">
                  {type.label}
                </TooltipContent>
              </Tooltip>
            )
          })}
        </div>
      </TooltipProvider>

      {mode === 'material-paint' ? (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <MaterialPaintPanel />
        </div>
      ) : null}
    </div>
  )
}

'use client'

import { getRoofAccessoryKinds, nodeRegistry } from '@pascal-app/core'
import { MaterialPaintPanel, triggerSFX, useEditor } from '@pascal-app/editor'
import Image from 'next/image'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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

type RoofFeature = { kind: string; label: string; iconSrc: string }

const ROOF_FEATURE_FALLBACK_ICON = '/icons/roof.png'

/**
 * Roof accessories surfaced under the Roof tile (a "Features" group). Unlike
 * the community editor these aren't DB presets — each is a registry kind with
 * `capabilities.roofAccessory`, discovered via `getRoofAccessoryKinds()` and
 * activated like any structure tool (the kind's tool attaches it to the roof
 * segment under the cursor). Label + icon come from the registry's
 * `presentation`; non-url icons fall back to the roof icon.
 */
function activateRoofFeatureTool(kind: string): void {
  const ed = useEditor.getState()
  ed.setPhase('structure')
  ed.setStructureLayer('elements')
  ed.setCatalogCategory(null)
  ed.setMode('build')
  ed.setTool(kind as Parameters<typeof ed.setTool>[0])
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
  // Which build tile's panel is showing. Roof is the only tile with a panel
  // (its Features group); others arm a tool and show nothing below.
  const [selectedTypeId, setSelectedTypeId] = useState<string | null>(null)

  // Read at render time (not module scope): the registry is populated by the
  // app bootstrap, so enumerating earlier would race it and see no kinds.
  const roofFeatures = useMemo<RoofFeature[]>(
    () =>
      getRoofAccessoryKinds().map((kind) => {
        const icon = nodeRegistry.get(kind)?.presentation?.icon
        return {
          kind,
          label: nodeRegistry.get(kind)?.presentation?.label ?? kind,
          iconSrc: icon?.kind === 'url' ? icon.src : ROOF_FEATURE_FALLBACK_ICON,
        }
      }),
    [],
  )

  const isTypeActive = (type: BuildType) =>
    type.mode === 'material-paint' ? mode === 'material-paint' : selectedTypeId === type.id

  const handleTypeClick = useCallback((type: BuildType) => {
    if (type.mode === 'material-paint') {
      activatePaintMode()
    } else if (type.kind) {
      activateBuildTool(type.kind)
    }
    setSelectedTypeId(type.id)
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
      ) : selectedTypeId === 'roof' && roofFeatures.length > 0 ? (
        <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
          <div className="px-0.5 pt-1 font-medium text-muted-foreground text-xs">Features</div>
          <TooltipProvider delayDuration={0} disableHoverableContent>
            <div
              className="grid gap-1.5"
              style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(56px, 1fr))' }}
            >
              {roofFeatures.map((feature) => {
                const active = mode === 'build' && activeTool === feature.kind
                return (
                  <Tooltip key={feature.kind}>
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
                          activateRoofFeatureTool(feature.kind)
                        }}
                        onMouseEnter={() => triggerSFX('sfx:menu-hover')}
                        type="button"
                      >
                        <Image
                          alt={feature.label}
                          className="size-full object-contain transition-transform duration-200 group-hover:scale-110"
                          height={48}
                          src={feature.iconSrc}
                          width={48}
                        />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent className="pointer-events-none" side="top">
                      {feature.label}
                    </TooltipContent>
                  </Tooltip>
                )
              })}
            </div>
          </TooltipProvider>
        </div>
      ) : null}
    </div>
  )
}

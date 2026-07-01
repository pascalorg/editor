'use client'

import { nodeRegistry } from '@pascal-app/core'
import { MaterialPaintPanel, triggerSFX, useEditor } from '@pascal-app/editor'
import { useLiquidLineToolOptions } from '@pascal-app/nodes'
import Image from 'next/image'
import { useCallback, useEffect, useMemo, useRef } from 'react'
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

/**
 * MEP (mechanical / plumbing) tool kinds surfaced under the Build tab's "MEP"
 * group tile — its own sub-grid, like Roof's "Features".
 */
type MepToolKind =
  | 'duct-segment'
  | 'duct-fitting'
  | 'duct-terminal'
  | 'hvac-equipment'
  | 'lineset'
  | 'liquid-line'
  | 'pipe-segment'
  | 'pipe-fitting'
  | 'pipe-trap'

type BuildType = {
  /** Selection id — equals `kind` for tool types, `'painting'` for paint mode, `'mep'` for the MEP group. */
  id: string
  label: string
  /** Raster asset tile (legacy Build sidebar artwork). */
  iconSrc: string
  /** Present for structure-tool types (absent for paint mode and the MEP group). */
  kind?: BuildToolKind
  /** Non-placement special mode. */
  mode?: 'material-paint'
}

type MepItem = {
  /** Selection id — equals `kind`. */
  id: string
  label: string
  iconSrc: string
  kind: MepToolKind
}

// Same icons + ordering as the community Build sidebar, minus presets.
const BUILD_TYPES: BuildType[] = [
  { id: 'wall', label: 'Wall', iconSrc: '/icons/wall.webp', kind: 'wall' },
  { id: 'fence', label: 'Fence', iconSrc: '/icons/fence.webp', kind: 'fence' },
  { id: 'slab', label: 'Slab', iconSrc: '/icons/floor.webp', kind: 'slab' },
  { id: 'ceiling', label: 'Ceiling', iconSrc: '/icons/ceiling.webp', kind: 'ceiling' },
  { id: 'roof', label: 'Roof', iconSrc: '/icons/roof.webp', kind: 'roof' },
  { id: 'stair', label: 'Stairs', iconSrc: '/icons/stairs.webp', kind: 'stair' },
  { id: 'elevator', label: 'Elevator', iconSrc: '/icons/elevator.webp', kind: 'elevator' },
  { id: 'door', label: 'Door', iconSrc: '/icons/door.webp', kind: 'door' },
  { id: 'window', label: 'Window', iconSrc: '/icons/window.webp', kind: 'window' },
  { id: 'column', label: 'Column', iconSrc: '/icons/column.webp', kind: 'column' },
  { id: 'shelf', label: 'Shelf', iconSrc: '/icons/shelf.webp', kind: 'shelf' },
  { id: 'spawn', label: 'Spawn Point', iconSrc: '/icons/spawn-point.webp', kind: 'spawn' },
  // Group tile — no tool of its own; opens the MEP sub-grid below (like Roof).
  { id: 'mep', label: 'MEP', iconSrc: '/icons/HVAC.webp' },
  { id: 'painting', label: 'Painting', iconSrc: '/icons/paint.webp', mode: 'material-paint' },
]

// MEP sub-grid surfaced under the "MEP" tile — same icons + ordering the MEP
// tools had in the community Build sidebar.
const MEP_ITEMS: MepItem[] = [
  { id: 'duct-segment', label: 'Duct', iconSrc: '/icons/duct.webp', kind: 'duct-segment' },
  {
    id: 'duct-terminal',
    label: 'Register',
    iconSrc: '/icons/registers.webp',
    kind: 'duct-terminal',
  },
  { id: 'hvac-equipment', label: 'HVAC Unit', iconSrc: '/icons/HVAC.webp', kind: 'hvac-equipment' },
  { id: 'lineset', label: 'Lineset', iconSrc: '/icons/lineset.webp', kind: 'lineset' },
  { id: 'liquid-line', label: 'Liquid Line', iconSrc: '/icons/lineset.webp', kind: 'liquid-line' },
  { id: 'pipe-segment', label: 'DWV Pipe', iconSrc: '/icons/dwv-pipes.webp', kind: 'pipe-segment' },
]

/**
 * Activate a raw structure draw/cursor tool. Mirrors the editor's own
 * structure-tool activation (`setPhase`/`setStructureLayer`/`setMode`/`setTool`).
 */
function activateBuildTool(kind: BuildToolKind | MepToolKind): void {
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

const ROOF_FEATURE_FALLBACK_ICON = '/icons/roof.webp'

/**
 * Roof accessories surfaced under the Roof tile (a "Features" group). Unlike
 * the community editor these aren't DB presets — each is a registry kind with
 * `capabilities.roofAccessory`, enumerated from the registry at render time
 * (it is populated by the app bootstrap — a module-scope const would race it)
 * and activated like any structure tool (the kind's tool attaches it to the
 * roof segment under the cursor). Label + icon come from the registry's
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
// MEP tool kinds that, when active, mean the MEP group tile (and its sub-grid)
// is what the user is working in.
const MEP_TOOL_KINDS = new Set<string>([
  ...MEP_ITEMS.map((item) => item.kind),
  'duct-fitting',
  'pipe-fitting',
  'pipe-trap',
])

export function BuildTab() {
  const activeTool = useEditor((s) => s.tool)
  const mode = useEditor((s) => s.mode)
  const follow = useLiquidLineToolOptions((s) => s.follow)
  const toggleFollow = useLiquidLineToolOptions((s) => s.toggleFollow)

  // The fitting / follow tools are armed from a segment's panel, not a grid
  // tile — keep the segment tile lit so the panel (and the way back) stays
  // visible.
  const ductContext =
    mode === 'build' && (activeTool === 'duct-segment' || activeTool === 'duct-fitting')
  const pipeContext =
    mode === 'build' &&
    (activeTool === 'pipe-segment' || activeTool === 'pipe-fitting' || activeTool === 'pipe-trap')
  const liquidLineContext = mode === 'build' && activeTool === 'liquid-line'

  const isMepItemActive = (item: MepItem) =>
    item.kind === 'duct-segment'
      ? ductContext
      : item.kind === 'pipe-segment'
        ? pipeContext
        : item.kind === 'liquid-line'
          ? liquidLineContext
          : mode === 'build' && activeTool === item.kind

  // Read at render time (not module scope): the registry is populated by the
  // app bootstrap, so enumerating earlier would race it and see no kinds.
  const roofFeatures = useMemo<RoofFeature[]>(() => {
    const features: RoofFeature[] = []
    for (const [kind, def] of nodeRegistry.entries()) {
      if (def.capabilities.roofAccessory === undefined) continue
      // Door / window declare `roofAccessory` for the wall-face cut but
      // already have their own Build tiles — listing them here too
      // would duplicate the entry under Roof → Features.
      if (def.capabilities.wallOpeningPlacement) continue
      const icon = def.presentation?.icon
      features.push({
        kind,
        label: def.presentation?.label ?? kind,
        iconSrc: icon?.kind === 'url' ? icon.src : ROOF_FEATURE_FALLBACK_ICON,
      })
    }
    return features
  }, [])

  // Tile highlight derives from the single source of truth (the active tool /
  // mode), never a separate local selection — so keyboard shortcuts and panel
  // clicks always agree on which tile is lit.
  // The roof Features sub-grid arms roof-accessory tools (skylight, chimney,
  // …); keep the Roof tile lit (and its panel open) while any of them is the
  // active tool, the same way MEP stays lit for its sub-grid tools.
  const isRoofFeatureActive =
    mode === 'build' && !!activeTool && roofFeatures.some((f) => f.kind === activeTool)
  const isMepActive = mode === 'build' && !!activeTool && MEP_TOOL_KINDS.has(activeTool)

  const isTypeActive = (type: BuildType) => {
    if (type.mode === 'material-paint') return mode === 'material-paint'
    if (type.id === 'mep') return isMepActive
    if (type.id === 'roof')
      return mode === 'build' && (activeTool === 'roof' || isRoofFeatureActive)
    return mode === 'build' && activeTool === type.kind
  }

  const handleTypeClick = useCallback((type: BuildType) => {
    if (type.mode === 'material-paint') {
      activatePaintMode()
    } else if (type.id === 'mep') {
      // MEP is a group tile: arm its first tool so a usable tool is active
      // (and we leave any prior paint mode), then reveal the MEP sub-grid.
      activateBuildTool('duct-segment')
    } else if (type.kind) {
      activateBuildTool(type.kind)
    }
  }, [])

  // On open, land on the first build tool — parity with the community Build
  // sidebar, so switching to Build immediately arms a usable tool. Skip when a
  // build tool is already active (e.g. the B shortcut armed one before this
  // panel mounted): the active tool is the source of truth, not this default.
  const didInitRef = useRef(false)
  useEffect(() => {
    if (didInitRef.current) return
    didInitRef.current = true
    const ed = useEditor.getState()
    if (ed.mode === 'build' && ed.tool) return
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
      ) : mode === 'build' &&
        (activeTool === 'roof' || isRoofFeatureActive) &&
        roofFeatures.length > 0 ? (
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
      ) : isMepActive ? (
        <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
          <div className="px-0.5 pt-1 font-medium text-muted-foreground text-xs">MEP</div>
          <TooltipProvider delayDuration={0} disableHoverableContent>
            <div
              className="grid gap-1.5 px-0.5"
              style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(56px, 1fr))' }}
            >
              {MEP_ITEMS.map((item) => {
                const active = isMepItemActive(item)
                return (
                  <Tooltip key={item.id}>
                    <TooltipTrigger asChild>
                      <button
                        className={cn(
                          'group relative flex aspect-square items-center justify-center rounded-xl transition-all duration-200',
                          active
                            ? 'bg-primary/10 ring-1 ring-primary/50'
                            : 'bg-muted/40 opacity-70 grayscale hover:bg-muted hover:opacity-100 hover:grayscale-0',
                        )}
                        onClick={() => {
                          triggerSFX('sfx:menu-click')
                          activateBuildTool(item.kind)
                        }}
                        onMouseEnter={() => triggerSFX('sfx:menu-hover')}
                        type="button"
                      >
                        <Image
                          alt={item.label}
                          className="size-full object-contain transition-transform duration-200 group-hover:scale-110"
                          height={48}
                          src={item.iconSrc}
                          width={48}
                        />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent className="pointer-events-none" side="top">
                      {item.label}
                    </TooltipContent>
                  </Tooltip>
                )
              })}
            </div>
          </TooltipProvider>

          {ductContext ? (
            <div className="flex flex-col gap-1.5">
              <span className="text-muted-foreground text-xs">Duct</span>
              <button
                className={cn(
                  'flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition-all duration-200',
                  activeTool === 'duct-fitting'
                    ? 'bg-primary/10 ring-1 ring-primary/50'
                    : 'bg-muted/40 hover:bg-muted',
                )}
                onClick={() => {
                  triggerSFX('sfx:menu-click')
                  activateBuildTool(activeTool === 'duct-fitting' ? 'duct-segment' : 'duct-fitting')
                }}
                onMouseEnter={() => triggerSFX('sfx:menu-hover')}
                type="button"
              >
                <Image
                  alt=""
                  aria-hidden
                  className="size-4 object-contain"
                  height={16}
                  src="/icons/duct-fitting.webp"
                  width={16}
                />
                Add Fitting
              </button>
            </div>
          ) : null}

          {pipeContext ? (
            <div className="flex flex-col gap-1.5">
              <span className="text-muted-foreground text-xs">DWV Pipe</span>
              <button
                className={cn(
                  'flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition-all duration-200',
                  activeTool === 'pipe-fitting'
                    ? 'bg-primary/10 ring-1 ring-primary/50'
                    : 'bg-muted/40 hover:bg-muted',
                )}
                onClick={() => {
                  triggerSFX('sfx:menu-click')
                  activateBuildTool(activeTool === 'pipe-fitting' ? 'pipe-segment' : 'pipe-fitting')
                }}
                onMouseEnter={() => triggerSFX('sfx:menu-hover')}
                type="button"
              >
                <Image
                  alt=""
                  aria-hidden
                  className="size-4 object-contain"
                  height={16}
                  src="/icons/duct-fitting.webp"
                  width={16}
                />
                Add Fitting
              </button>
              <button
                className={cn(
                  'flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition-all duration-200',
                  activeTool === 'pipe-trap'
                    ? 'bg-primary/10 ring-1 ring-primary/50'
                    : 'bg-muted/40 hover:bg-muted',
                )}
                onClick={() => {
                  triggerSFX('sfx:menu-click')
                  activateBuildTool(activeTool === 'pipe-trap' ? 'pipe-segment' : 'pipe-trap')
                }}
                onMouseEnter={() => triggerSFX('sfx:menu-hover')}
                type="button"
              >
                <Image
                  alt=""
                  aria-hidden
                  className="size-4 object-contain"
                  height={16}
                  src="/icons/dwv-pipes.webp"
                  width={16}
                />
                Add Trap
              </button>
            </div>
          ) : null}

          {liquidLineContext ? (
            <div className="flex flex-col gap-1.5">
              <span className="text-muted-foreground text-xs">Liquid Line</span>
              <button
                className={cn(
                  'flex items-center justify-between gap-2 rounded-lg px-3 py-2 text-sm transition-all duration-200',
                  follow ? 'bg-primary/10 ring-1 ring-primary/50' : 'bg-muted/40 hover:bg-muted',
                )}
                onClick={() => {
                  triggerSFX('sfx:menu-click')
                  toggleFollow()
                }}
                onMouseEnter={() => triggerSFX('sfx:menu-hover')}
                type="button"
              >
                <span>Follow lineset</span>
                <span className="text-muted-foreground text-xs">{follow ? 'On' : 'Off'}</span>
              </button>
              <span className="px-1 text-[11px] text-muted-foreground">
                {follow
                  ? 'Click a lineset to lay the line beside it.'
                  : 'Trace a line alongside an existing lineset (F).'}
              </span>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

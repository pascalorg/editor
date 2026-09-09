'use client'

import { RoofType as RoofTypeSchema, useRegistryVersion } from '@pascal-app/core'
import {
  MaterialPaintPanel,
  TerrainSculptPanel,
  ToolOptionsPanel,
  triggerSFX,
  useEditor,
  useFloorplanMode,
} from '@pascal-app/editor'
import { useLiquidLineToolOptions } from '@pascal-app/nodes'
import Image from 'next/image'
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/toolbar-tooltip'
import {
  activateBuildTool,
  activateModularCabinetTool,
  activatePaintMode,
  activateRoofFeatureTool,
  activateRoofType,
  activateTerrainSculptMode,
  BASE_BUILD_TYPES,
  type BuildType,
  collectBuildTypes,
  collectRoofFeatures,
  MEP_ITEMS,
  MEP_TOOL_KINDS,
  type MepItem,
  MODULAR_CABINET_ICON,
} from '@/lib/build-palette'
import { getActiveRoofFeatureId, ROOF_TYPE_OPTIONS } from '@/lib/build-tab-state'
import { cn } from '@/lib/utils'

const subscribeToClientMount = () => () => {}

/**
 * Build tab for the open-source standalone editor — a preset-less replica of
 * the community Build sidebar. Clicking a type activates its raw tool, drawn
 * with the kind's own `def.defaults()`. The "Painting" type swaps in the
 * material-paint panel.
 */
// MEP tool kinds that, when active, mean the MEP group tile (and its sub-grid)
// is what the user is working in.
export function BuildTab() {
  const [mepOpen, setMepOpen] = useState(false)
  const activeTool = useEditor((s) => s.tool)
  const mode = useEditor((s) => s.mode)
  const roofDefaults = useEditor((s) => s.toolDefaults.roof)
  const floorplanMode = useFloorplanMode((s) => s.mode)
  const follow = useLiquidLineToolOptions((s) => s.follow)
  const toggleFollow = useLiquidLineToolOptions((s) => s.toggleFollow)
  useRegistryVersion()
  const registryReady = useSyncExternalStore(
    subscribeToClientMount,
    () => true,
    () => false,
  )
  const buildTypes = registryReady ? collectBuildTypes(floorplanMode) : BASE_BUILD_TYPES

  const ductContext =
    mode === 'build' && (activeTool === 'duct-segment' || activeTool === 'duct-fitting')
  const pipeContext =
    mode === 'build' &&
    (activeTool === 'pipe-segment' || activeTool === 'pipe-fitting' || activeTool === 'pipe-trap')
  const liquidLineContext = mode === 'build' && activeTool === 'liquid-line'

  const isMepItemActive = (item: MepItem) => mode === 'build' && activeTool === item.kind

  // Read at render time (not module scope): the registry is populated by the
  // app bootstrap, so enumerating earlier would race it and see no kinds.
  const roofFeatures = registryReady ? collectRoofFeatures() : []

  // Tile highlight derives from the single source of truth (the active tool /
  // mode), never a separate local selection — so keyboard shortcuts and panel
  // clicks always agree on which tile is lit.
  // The roof Features sub-grid arms roof-accessory tools (skylight, chimney,
  // …); keep the Roof tile lit (and its panel open) while any of them is the
  // active tool, the same way MEP stays lit for its sub-grid tools.
  const activeRoofFeatureId = getActiveRoofFeatureId(roofFeatures, activeTool)
  const isRoofFeatureActive = mode === 'build' && activeRoofFeatureId !== null
  const isMepActive =
    (mode === 'build' && !!activeTool && MEP_TOOL_KINDS.has(activeTool)) ||
    (mode === 'select' && mepOpen)
  const isKitchenActive = mode === 'build' && activeTool === 'cabinet'
  const parsedRoofType = RoofTypeSchema.safeParse(roofDefaults?.roofType)
  const activeRoofType = parsedRoofType.success ? parsedRoofType.data : 'gable'

  const isTypeActive = (type: BuildType) => {
    if (type.mode) return mode === type.mode
    if (type.id === 'mep') return isMepActive
    if (type.id === 'kitchen') return isKitchenActive
    if (type.id === 'roof')
      return mode === 'build' && (activeTool === 'roof' || isRoofFeatureActive)
    return mode === 'build' && activeTool === type.kind
  }

  const handleTypeClick = useCallback((type: BuildType) => {
    setMepOpen(type.id === 'mep')
    if (type.mode === 'material-paint') {
      activatePaintMode()
    } else if (type.mode === 'terrain-sculpt') {
      activateTerrainSculptMode()
    } else if (type.id === 'mep') {
      const ed = useEditor.getState()
      ed.setPhase('structure')
      ed.setStructureLayer('elements')
      ed.setCatalogCategory(null)
      ed.setMode('build')
      ed.setTool(null)
    } else if (type.id === 'kitchen') {
      activateModularCabinetTool()
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
    const firstType = buildTypes.find((t) => t.kind)
    if (firstType) handleTypeClick(firstType)
  }, [buildTypes, handleTypeClick])

  return (
    <div className="flex h-full flex-col gap-3 p-3">
      <TooltipProvider delayDuration={0} disableHoverableContent>
        <div
          className="grid gap-1.5"
          style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(56px, 1fr))' }}
        >
          {buildTypes.map((type) => {
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
      ) : mode === 'terrain-sculpt' ? (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <TerrainSculptPanel />
        </div>
      ) : mode === 'build' && (activeTool === 'roof' || isRoofFeatureActive) ? (
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
          <div className="flex flex-col gap-2">
            <div className="px-0.5 pt-1 font-medium text-muted-foreground text-xs">Roof type</div>
            <div className="grid grid-cols-2 gap-1.5">
              {ROOF_TYPE_OPTIONS.map((roofType) => {
                const active = activeTool === 'roof' && activeRoofType === roofType.value
                return (
                  <button
                    aria-pressed={active}
                    className={cn(
                      'rounded-lg px-2.5 py-2 text-left font-medium text-xs transition-colors',
                      active
                        ? 'bg-primary/10 text-primary ring-1 ring-primary/50'
                        : 'bg-muted/40 text-muted-foreground hover:bg-muted hover:text-foreground',
                    )}
                    key={roofType.value}
                    onClick={() => {
                      triggerSFX('sfx:menu-click')
                      activateRoofType(roofType.value)
                    }}
                    onMouseEnter={() => triggerSFX('sfx:menu-hover')}
                    type="button"
                  >
                    {roofType.label}
                  </button>
                )
              })}
            </div>
          </div>

          <ToolOptionsPanel
            className="border-border/50 border-t pt-3"
            kind="roof"
            onSelect={() => {
              const editor = useEditor.getState()
              if (!(editor.mode === 'build' && editor.tool === 'roof')) activateBuildTool('roof')
            }}
          />
          {activeRoofType === 'conical' && (
            <p className="border-border/50 border-t px-0.5 pt-3 text-[11px] text-muted-foreground leading-relaxed">
              Select a curved wall to match its radius and arc.
            </p>
          )}

          {roofFeatures.length > 0 ? (
            <div className="flex flex-col gap-2 border-border/50 border-t pt-3">
              <div className="px-0.5 font-medium text-muted-foreground text-xs">
                Features & extensions
              </div>
              <TooltipProvider delayDuration={0} disableHoverableContent>
                <div
                  className="grid gap-1.5"
                  style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(56px, 1fr))' }}
                >
                  {roofFeatures.map((feature) => {
                    const active = mode === 'build' && feature.id === activeRoofFeatureId
                    return (
                      <Tooltip key={feature.id}>
                        <TooltipTrigger asChild>
                          <button
                            aria-pressed={active}
                            className={cn(
                              'group relative flex aspect-square items-center justify-center rounded-xl p-1 transition-all duration-200',
                              active
                                ? 'bg-primary/10 ring-1 ring-primary/50'
                                : 'bg-muted/40 opacity-70 grayscale hover:bg-muted hover:opacity-100 hover:grayscale-0',
                            )}
                            onClick={() => {
                              triggerSFX('sfx:menu-click')
                              activateRoofFeatureTool(feature)
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
      ) : isKitchenActive ? (
        <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
          <div className="px-0.5 pt-1 font-medium text-muted-foreground text-xs">Kitchen</div>
          <TooltipProvider delayDuration={0} disableHoverableContent>
            <div
              className="grid gap-1.5 px-0.5"
              style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(56px, 1fr))' }}
            >
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    className="group relative flex aspect-square items-center justify-center rounded-xl bg-primary/10 p-1 ring-1 ring-primary/50 transition-all duration-200"
                    onClick={() => {
                      triggerSFX('sfx:menu-click')
                      activateModularCabinetTool()
                    }}
                    onMouseEnter={() => triggerSFX('sfx:menu-hover')}
                    type="button"
                  >
                    <Image
                      alt="Modular Cabinet"
                      className="size-full object-contain transition-transform duration-200 group-hover:scale-110"
                      height={48}
                      src={MODULAR_CABINET_ICON}
                      width={48}
                    />
                  </button>
                </TooltipTrigger>
                <TooltipContent className="pointer-events-none" side="top">
                  Modular Cabinet
                </TooltipContent>
              </Tooltip>
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
                        aria-pressed={active}
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

          {(['duct-fitting', 'pipe-fitting'] as const)
            .filter((kind) => (kind === 'duct-fitting' ? ductContext : pipeContext))
            .map((kind) => (
              <ToolOptionsPanel
                active={activeTool === kind}
                key={kind}
                getChoiceThumbnail={(option, value) => {
                  if (option.id !== 'fittingType') return undefined
                  if (kind === 'duct-fitting' && value === 'elbow')
                    return '/icons/duct-fitting.webp'
                  return `/icons/fittings/${kind === 'duct-fitting' ? 'duct' : 'pipe'}-${value}.png`
                }}
                kind={kind}
                onSelect={(option, value) => {
                  if (activeTool !== kind) {
                    const defaults = useEditor.getState().toolDefaults[kind]
                    activateBuildTool(kind)
                    if (defaults) useEditor.getState().setToolDefaults(kind, defaults)
                  }
                  option.set(value)
                }}
              />
            ))}

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

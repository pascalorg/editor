'use client'

import { RoofType as RoofTypeSchema, useRegistryVersion } from '@pascal-app/core'
import {
  BuildPanelAdvancedSection,
  BuildPanelRoomsSection,
  BuildPanelSection,
  BuildToolGrid,
  BuildToolTile,
  MaterialPaintPanel,
  selectWallDrawVariant,
  startTerraceDraft,
  TerrainSculptPanel,
  ToolOptionsPanel,
  triggerSFX,
  useEditor,
  useFloorplanMode,
  useTerraceDraft,
  useWallDrawVariant,
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
export function BuildTab() {
  const [mepOpen, setMepOpen] = useState(false)
  const activeTool = useEditor((s) => s.tool)
  const mode = useEditor((s) => s.mode)
  const isTerraceActive = useTerraceDraft((s) => !!s.host)
  const roofDefaults = useEditor((s) => s.toolDefaults.roof)
  const floorplanMode = useFloorplanMode((s) => s.mode)
  const wallVariant = useWallDrawVariant()
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
    if (type.id === 'terrace') return isTerraceActive
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
    } else if (type.id === 'terrace') {
      startTerraceDraft()
    } else if (type.kind) {
      activateBuildTool(type.kind)
    }
  }, [])

  // On open, land on the first build tool — parity with the community Build
  // sidebar, so switching to Build immediately arms a usable tool. Skip when a
  // Build-tab tool or special mode is already active: the current editor state
  // is the source of truth, including entry from another panel.
  const didInitRef = useRef(false)
  useEffect(() => {
    if (didInitRef.current) return
    didInitRef.current = true
    const ed = useEditor.getState()
    if (ed.mode === 'material-paint' || ed.mode === 'terrain-sculpt') return
    if (ed.mode === 'build' && ed.tool) return
    const firstType = buildTypes.find((t) => t.kind)
    if (firstType) handleTypeClick(firstType)
  }, [buildTypes, handleTypeClick])

  const renderTile = (type: BuildType) => (
    <BuildToolTile
      active={isTypeActive(type)}
      data-build-tool={type.id}
      iconSrc={type.iconSrc}
      key={type.id}
      label={type.label}
      onClick={() => {
        triggerSFX('sfx:menu-click')
        handleTypeClick(type)
      }}
      onMouseEnter={() => triggerSFX('sfx:menu-hover')}
      title={type.label}
    />
  )
  const typesIn = (section: NonNullable<BuildType['section']>) =>
    buildTypes.filter((type) => type.section === section)
  const advancedTypes = typesIn('advanced')

  return (
    <div className="flex h-full flex-col gap-3 overflow-y-auto p-3">
      <div className="flex flex-col gap-3 [&>section+section]:border-border/60 [&>section+section]:border-t [&>section+section]:pt-3">
        <BuildPanelRoomsSection
          activeVariant={mode === 'build' && activeTool === 'wall' ? wallVariant : null}
          onHover={() => triggerSFX('sfx:menu-hover')}
          onSelect={(variant) => {
            triggerSFX('sfx:menu-click')
            selectWallDrawVariant(variant)
            const editor = useEditor.getState()
            if (!(editor.mode === 'build' && editor.tool === 'wall')) activateBuildTool('wall')
          }}
        />
        <BuildPanelSection id="add" title="Add to rooms">
          <BuildToolGrid columns={4}>{typesIn('add').map(renderTile)}</BuildToolGrid>
        </BuildPanelSection>
        <BuildPanelSection id="outdoor" title="Outdoor">
          <BuildToolGrid columns={4}>{typesIn('outdoor').map(renderTile)}</BuildToolGrid>
        </BuildPanelSection>
        <BuildPanelAdvancedSection
          containsActiveTool={advancedTypes.some(isTypeActive)}
          description="Rooms already create their floor and ceiling. Use these for platforms and one-off structure."
          hint="Slab, ceiling, column…"
        >
          <BuildToolGrid columns={4}>{advancedTypes.map(renderTile)}</BuildToolGrid>
        </BuildPanelAdvancedSection>
      </div>

      {mode === 'material-paint' ? (
        <div className="border-border/60 border-t pt-3">
          <MaterialPaintPanel />
        </div>
      ) : mode === 'terrain-sculpt' ? (
        <div className="border-border/60 border-t pt-3">
          <TerrainSculptPanel />
        </div>
      ) : mode === 'build' && (activeTool === 'roof' || isRoofFeatureActive) ? (
        <div className="flex flex-col gap-3 border-border/60 border-t pt-3">
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
        <div className="flex flex-col gap-2 border-border/60 border-t pt-3">
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
        <div className="flex flex-col gap-2 border-border/60 border-t pt-3">
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
                  return `/icons/fittings/${kind === 'duct-fitting' ? 'duct' : 'pipe'}-${value}.webp`
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

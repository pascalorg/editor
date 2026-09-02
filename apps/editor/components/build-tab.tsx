'use client'

import {
  nodeRegistry,
  type RoofType,
  RoofType as RoofTypeSchema,
  useRegistryVersion,
} from '@pascal-app/core'
import {
  CATALOG_ITEMS,
  type FloorplanMode,
  getFloorplanNodeExtension,
  isFloorplanToolAvailableInMode,
  MaterialPaintPanel,
  TerrainSculptPanel,
  ToolOptionsPanel,
  triggerSFX,
  useEditor,
  useFloorplanMode,
  useTranslations,
} from '@pascal-app/editor'
import { useLiquidLineToolOptions } from '@pascal-app/nodes'
import { useViewer } from '@pascal-app/viewer'
import Image from 'next/image'
import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/toolbar-tooltip'
import { getActiveRoofFeatureId, ROOF_TYPE_OPTIONS } from '@/lib/build-tab-state'
import { cn } from '@/lib/utils'

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
  /** Selection id — equals `kind` for tool types, with dedicated ids for modes and groups. */
  id: string
  /** i18n key for the visible label. Resolved at render time via `t(labelKey)`. */
  labelKey: string
  /** Fallback string for registry-driven kinds (their `presentation.label`); used when labelKey is empty. */
  label?: string
  /** Raster asset tile (legacy Build sidebar artwork). */
  iconSrc: string
  /** Present for structure-tool types (absent for paint mode and the MEP group). */
  kind?: string
  paletteOrder?: number
  /** Non-placement special mode. */
  mode?: 'material-paint' | 'terrain-sculpt'
}

type MepItem = {
  /** Selection id — equals `kind`. */
  id: string
  labelKey: string
  iconSrc: string
  kind: MepToolKind
}

// Same icons + ordering as the community Build sidebar, minus presets.
const BASE_BUILD_TYPES: BuildType[] = [
  { id: 'wall', labelKey: 'buildTab.tile.wall', iconSrc: '/icons/wall.webp', kind: 'wall' },
  { id: 'fence', labelKey: 'buildTab.tile.fence', iconSrc: '/icons/fence.webp', kind: 'fence' },
  { id: 'slab', labelKey: 'buildTab.tile.slab', iconSrc: '/icons/floor.webp', kind: 'slab' },
  { id: 'ceiling', labelKey: 'buildTab.tile.ceiling', iconSrc: '/icons/ceiling.webp', kind: 'ceiling' },
  { id: 'roof', labelKey: 'buildTab.tile.roof', iconSrc: '/icons/roof.webp', kind: 'roof' },
  { id: 'stair', labelKey: 'buildTab.tile.stairs', iconSrc: '/icons/stairs.webp', kind: 'stair' },
  { id: 'elevator', labelKey: 'buildTab.tile.elevator', iconSrc: '/icons/elevator.webp', kind: 'elevator' },
  { id: 'door', labelKey: 'buildTab.tile.door', iconSrc: '/icons/door.webp', kind: 'door' },
  { id: 'window', labelKey: 'buildTab.tile.window', iconSrc: '/icons/window.webp', kind: 'window' },
  { id: 'column', labelKey: 'buildTab.tile.column', iconSrc: '/icons/column.webp', kind: 'column' },
  { id: 'shelf', labelKey: 'buildTab.tile.shelf', iconSrc: '/icons/shelf.webp', kind: 'shelf' },
  { id: 'spawn', labelKey: 'buildTab.tile.spawn', iconSrc: '/icons/spawn-point.webp', kind: 'spawn' },
  { id: 'kitchen', labelKey: 'buildTab.tile.kitchen', iconSrc: '/icons/kitchen.webp' },
  // Group tile — no tool of its own; opens the MEP sub-grid below (like Roof).
  { id: 'mep', labelKey: 'buildTab.tile.mep', iconSrc: '/icons/HVAC.webp' },
  { id: 'painting', labelKey: 'buildTab.tile.painting', iconSrc: '/icons/paint.webp', mode: 'material-paint' },
  { id: 'terrain', labelKey: 'buildTab.tile.terrain', iconSrc: '/icons/mesh.webp', mode: 'terrain-sculpt' },
]

const subscribeToClientMount = () => () => {}

function collectBuildTypes(floorplanMode: FloorplanMode): BuildType[] {
  const baseKinds = new Set(BASE_BUILD_TYPES.flatMap((type) => (type.kind ? [type.kind] : [])))
  const tools = BASE_BUILD_TYPES.filter((type) => type.kind).map((type, index) => ({
    ...type,
    paletteOrder:
      nodeRegistry.get(type.kind!)?.presentation?.paletteOrder ?? type.paletteOrder ?? index * 10,
  }))
  for (const [kind, definition] of nodeRegistry.entries()) {
    const presentation = definition.presentation
    const extension = getFloorplanNodeExtension(definition)
    if (
      baseKinds.has(kind) ||
      definition.presentation?.paletteGroup === 'roof-features' ||
      !extension?.tool ||
      !isFloorplanToolAvailableInMode(extension.availableModes, floorplanMode) ||
      !presentation ||
      presentation.hidden ||
      presentation.paletteSection !== 'structure'
    ) {
      continue
    }
    tools.push({
      id: kind,
      kind,
      // Prefer the i18n key the definition ships (`presentation.labelKey`),
      // falling back to the hardcoded `presentation.label` for kinds that
      // don't carry one yet. The render path picks `labelKey` first and only
      // falls back to `label` when the key is empty.
      labelKey: presentation.labelKey ?? '',
      label: presentation.label,
      iconSrc: presentation.icon.kind === 'url' ? presentation.icon.src : '/icons/spawn-point.webp',
      paletteOrder: presentation.paletteOrder ?? Number.MAX_SAFE_INTEGER,
    })
  }
  tools.sort((left, right) => (left.paletteOrder ?? 0) - (right.paletteOrder ?? 0))
  return [...tools, ...BASE_BUILD_TYPES.filter((type) => !type.kind)]
}

// MEP sub-grid surfaced under the "MEP" tile — same icons + ordering the MEP
// tools had in the community Build sidebar.
const MEP_ITEMS: MepItem[] = [
  { id: 'duct-segment', labelKey: 'buildTab.mep.duct', iconSrc: '/icons/duct.webp', kind: 'duct-segment' },
  {
    id: 'duct-terminal',
    labelKey: 'buildTab.mep.register',
    iconSrc: '/icons/registers.webp',
    kind: 'duct-terminal',
  },
  { id: 'hvac-equipment', labelKey: 'buildTab.mep.hvacUnit', iconSrc: '/icons/HVAC.webp', kind: 'hvac-equipment' },
  { id: 'lineset', labelKey: 'buildTab.mep.lineset', iconSrc: '/icons/lineset.webp', kind: 'lineset' },
  { id: 'liquid-line', labelKey: 'buildTab.mep.liquidLine', iconSrc: '/icons/lineset.webp', kind: 'liquid-line' },
  { id: 'pipe-segment', labelKey: 'buildTab.mep.dwvPipe', iconSrc: '/icons/dwv-pipes.webp', kind: 'pipe-segment' },
]

const MODULAR_CABINET_CATALOG_ITEM = CATALOG_ITEMS.find((item) => item.id === 'cabinet')
const MODULAR_CABINET_ICON = MODULAR_CABINET_CATALOG_ITEM?.thumbnail ?? '/icons/item.webp'

/**
 * Activate a raw structure draw/cursor tool. Mirrors the editor's own
 * structure-tool activation (`setPhase`/`setStructureLayer`/`setMode`/`setTool`).
 */
function activateBuildTool(kind: string): void {
  const ed = useEditor.getState()
  const definition = nodeRegistry.get(kind)
  const extension = getFloorplanNodeExtension(definition)
  if (
    !isFloorplanToolAvailableInMode(extension?.availableModes, useFloorplanMode.getState().mode)
  ) {
    useFloorplanMode.getState().showExpertModeNotice(definition?.presentation?.label ?? kind)
    return
  }
  const preferredView = extension?.preferredView
  if (preferredView) ed.setViewMode(preferredView)
  ed.setPhase('structure')
  ed.setStructureLayer('elements')
  ed.setCatalogCategory(null)
  ed.setToolDefaults(kind, null)
  ed.setMode('build')
  ed.setTool(kind)
}

function activateModularCabinetTool(): void {
  const ed = useEditor.getState()
  useViewer.getState().setSelection({ selectedIds: [], zoneId: null })
  if (MODULAR_CABINET_CATALOG_ITEM) ed.setSelectedItem(MODULAR_CABINET_CATALOG_ITEM)
  ed.setPhase('structure')
  ed.setStructureLayer('elements')
  ed.setCatalogCategory(null)
  ed.setMode('build')
  ed.setTool('cabinet')
}

/** Enter material-paint mode — the Build tab's "Painting" category. */
function activatePaintMode(): void {
  const ed = useEditor.getState()
  ed.setPhase('structure')
  ed.setStructureLayer('elements')
  ed.setMode('material-paint')
}

/**
 * Enter terrain-sculpt mode — the Build tab's "Terrain" category. No `setPhase`:
 * `setMode` moves to the site phase itself, since sculpting is a site-phase mode.
 */
function activateTerrainSculptMode(): void {
  useEditor.getState().setMode('terrain-sculpt')
}

type RoofFeature = {
  id: string
  label: string
  iconSrc: string
  kind?: string
}

const ROOF_FEATURE_FALLBACK_ICON = '/icons/roof.webp'

function collectRoofFeatures(): RoofFeature[] {
  const features: RoofFeature[] = []
  for (const [kind, def] of nodeRegistry.entries()) {
    if (
      def.capabilities.roofAccessory === undefined &&
      def.presentation?.paletteGroup !== 'roof-features'
    ) {
      continue
    }
    if (def.capabilities.wallOpeningPlacement) continue
    const icon = def.presentation?.icon
    features.push({
      id: kind,
      kind,
      label: def.presentation?.label ?? kind,
      iconSrc: icon?.kind === 'url' ? icon.src : ROOF_FEATURE_FALLBACK_ICON,
    })
  }
  return features
}

/**
 * Roof accessories and extensions surfaced under the Roof tile. Unlike the
 * community editor these aren't DB presets — each is a registry kind, either
 * carrying `capabilities.roofAccessory` or explicitly classified as a roof
 * extension. They are enumerated at render time because the registry is
 * populated during app bootstrap. Label + icon come from `presentation`;
 * non-url icons fall back to the roof icon.
 */
function activateRoofFeatureTool(feature: RoofFeature): void {
  const ed = useEditor.getState()
  ed.setPhase('structure')
  ed.setStructureLayer('elements')
  ed.setCatalogCategory(null)
  ed.setMode('build')
  if (feature.kind) ed.setTool(feature.kind)
}

function activateRoofType(roofType: RoofType): void {
  const editor = useEditor.getState()
  if (!(editor.mode === 'build' && editor.tool === 'roof')) activateBuildTool('roof')
  editor.setToolDefaults('roof', { ...editor.toolDefaults.roof, roofType })
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
  const t = useTranslations()
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
  const roofFeatures = registryReady ? collectRoofFeatures() : []

  // Tile highlight derives from the single source of truth (the active tool /
  // mode), never a separate local selection — so keyboard shortcuts and panel
  // clicks always agree on which tile is lit.
  // The roof Features sub-grid arms roof-accessory tools (skylight, chimney,
  // …); keep the Roof tile lit (and its panel open) while any of them is the
  // active tool, the same way MEP stays lit for its sub-grid tools.
  const activeRoofFeatureId = getActiveRoofFeatureId(roofFeatures, activeTool)
  const isRoofFeatureActive = mode === 'build' && activeRoofFeatureId !== null
  const isMepActive = mode === 'build' && !!activeTool && MEP_TOOL_KINDS.has(activeTool)
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
    if (type.mode === 'material-paint') {
      activatePaintMode()
    } else if (type.mode === 'terrain-sculpt') {
      activateTerrainSculptMode()
    } else if (type.id === 'mep') {
      // MEP is a group tile: arm its first tool so a usable tool is active
      // (and we leave any prior paint mode), then reveal the MEP sub-grid.
      activateBuildTool('duct-segment')
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
            const label = type.labelKey ? t(type.labelKey) : (type.label ?? type.id)
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
                      alt={label}
                      className="size-full object-contain transition-transform duration-200 group-hover:scale-110"
                      height={48}
                      src={type.iconSrc}
                      width={48}
                    />
                  </button>
                </TooltipTrigger>
                <TooltipContent className="pointer-events-none" side="top">
                  {label}
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
            <div className="px-0.5 pt-1 font-medium text-muted-foreground text-xs">
              {t('buildTab.section.roofType')}
            </div>
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
                    {t(roofType.labelKey)}
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
              {t('buildTab.roofSource.conicalHint')}
            </p>
          )}

          {roofFeatures.length > 0 ? (
            <div className="flex flex-col gap-2 border-border/50 border-t pt-3">
              <div className="px-0.5 font-medium text-muted-foreground text-xs">
                {t('buildTab.section.featuresAndExtensions')}
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
          <div className="px-0.5 pt-1 font-medium text-muted-foreground text-xs">
            {t('buildTab.tile.kitchen')}
          </div>
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
                      alt={t('buildTab.mep.modularCabinet')}
                      className="size-full object-contain transition-transform duration-200 group-hover:scale-110"
                      height={48}
                      src={MODULAR_CABINET_ICON}
                      width={48}
                    />
                  </button>
                </TooltipTrigger>
                <TooltipContent className="pointer-events-none" side="top">
                  {t('buildTab.mep.modularCabinet')}
                </TooltipContent>
              </Tooltip>
            </div>
          </TooltipProvider>
        </div>
      ) : isMepActive ? (
        <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
          <div className="px-0.5 pt-1 font-medium text-muted-foreground text-xs">
            {t('buildTab.tile.mep')}
          </div>
          <TooltipProvider delayDuration={0} disableHoverableContent>
            <div
              className="grid gap-1.5 px-0.5"
              style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(56px, 1fr))' }}
            >
              {MEP_ITEMS.map((item) => {
                const active = isMepItemActive(item)
                const label = t(item.labelKey)
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
                          alt={label}
                          className="size-full object-contain transition-transform duration-200 group-hover:scale-110"
                          height={48}
                          src={item.iconSrc}
                          width={48}
                        />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent className="pointer-events-none" side="top">
                      {label}
                    </TooltipContent>
                  </Tooltip>
                )
              })}
            </div>
          </TooltipProvider>

          {ductContext ? (
            <div className="flex flex-col gap-1.5">
              <span className="text-muted-foreground text-xs">{t('buildTab.mep.duct')}</span>
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
                {t('buildTab.action.addFitting')}
              </button>
            </div>
          ) : null}

          {pipeContext ? (
            <div className="flex flex-col gap-1.5">
              <span className="text-muted-foreground text-xs">{t('buildTab.mep.dwvPipe')}</span>
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
                {t('buildTab.action.addFitting')}
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
                {t('buildTab.action.addTrap')}
              </button>
            </div>
          ) : null}

          {liquidLineContext ? (
            <div className="flex flex-col gap-1.5">
              <span className="text-muted-foreground text-xs">{t('buildTab.mep.liquidLine')}</span>
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
                <span>{t('buildTab.liquidLine.followLineset')}</span>
                <span className="text-muted-foreground text-xs">
                  {follow ? t('buildTab.toggle.on') : t('buildTab.toggle.off')}
                </span>
              </button>
              <span className="px-1 text-[11px] text-muted-foreground">
                {follow
                  ? t('buildTab.liquidLine.followHintOn')
                  : t('buildTab.liquidLine.followHintOff')}
              </span>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

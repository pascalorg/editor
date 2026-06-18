'use client'

import { Icon as IconifyIcon } from '@iconify/react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
  useEditor,
  useSidebarStore,
  type ViewMode,
} from '@pascal-app/editor'
import {
  type EdgeMode,
  getSceneTheme,
  type RenderShading,
  SCENE_THEMES,
  type SceneSurfaceRole,
  useViewer,
} from '@pascal-app/viewer'
import {
  Box,
  Check,
  ChevronsLeft,
  ChevronsRight,
  Columns2,
  Contrast,
  Eye,
  Footprints,
  Grid2X2,
  Magnet,
  PenLine,
  SlidersHorizontal,
  Sparkles,
  SwatchBook,
} from 'lucide-react'
import Image from 'next/image'
import { type ReactNode, useCallback, useMemo } from 'react'
import { flushSync } from 'react-dom'
import { t } from '@/i18n'
import { cn } from '@/lib/utils'
import { Tooltip, TooltipContent, TooltipTrigger } from './toolbar-tooltip'

const TOOLBAR_CONTAINER =
  'inline-flex h-8 items-stretch overflow-hidden rounded-xl border border-border bg-background/90 shadow-2xl backdrop-blur-md'

const TOOLBAR_BTN =
  'flex w-8 items-center justify-center text-muted-foreground/80 transition-colors hover:bg-white/8 hover:text-foreground/90'

function requestWalkthroughPointerLock() {
  const canvas = document.querySelector<HTMLCanvasElement>('[data-pascal-viewer-3d] canvas')
  if (!canvas) return

  if (!canvas.hasAttribute('tabindex')) {
    canvas.tabIndex = -1
  }
  canvas.focus({ preventScroll: true })

  if (document.pointerLockElement === canvas) return

  try {
    canvas.requestPointerLock?.()
  } catch {
    return
  }
}

function ToolbarTooltip({ children, label }: { children: ReactNode; label: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  )
}

const VIEW_MODE_IDS: {
  id: ViewMode
  labelKey?: string
  fallback: string
  icon: React.ReactNode
}[] = [
  {
    id: '3d',
    fallback: '3D',
    icon: (
      <Image
        alt=""
        className="h-3.5 w-3.5 object-contain"
        height={14}
        src="/icons/building.webp"
        width={14}
      />
    ),
  },
  {
    id: '2d',
    fallback: '2D',
    icon: (
      <Image
        alt=""
        className="h-3.5 w-3.5 object-contain"
        height={14}
        src="/icons/blueprint.webp"
        width={14}
      />
    ),
  },
  {
    id: 'split',
    labelKey: 'toolbar.split',
    fallback: 'Split',
    icon: <Columns2 className="h-3 w-3" />,
  },
]

const levelModeOrder = ['stacked', 'exploded', 'solo'] as const

function levelModeLabel(mode: string): string {
  const fallbacks: Record<string, string> = {
    manual: 'Manual',
    stacked: 'Stack',
    exploded: 'Exploded',
    solo: 'Solo',
  }
  return t(`toolbar.levelMode.${mode}`, fallbacks[mode] ?? 'Stack')
}

const wallModeOrder = ['cutaway', 'up', 'down'] as const

function wallModeLabel(mode: string): string {
  const fallbacks: Record<string, string> = {
    up: 'Full height',
    cutaway: 'Cutaway',
    down: 'Low',
  }
  return t(`toolbar.wallMode.${mode}`, fallbacks[mode] ?? 'Cutaway')
}

const wallModeIcons: Record<string, string> = {
  up: '/icons/room.webp',
  cutaway: '/icons/wallcut.webp',
  down: '/icons/walllow.webp',
}

const SHADING_OPTIONS = [
  {
    id: 'solid',
    name: 'Solid',
    labelKey: 'toolbar.renderModes.solid',
    detailKey: 'toolbar.renderModes.solidDetail',
    detail: 'Flat and fast',
    icon: Box,
  },
  {
    id: 'rendered',
    name: 'Rendered',
    labelKey: 'toolbar.renderModes.rendered',
    detailKey: 'toolbar.renderModes.renderedDetail',
    detail: 'Full ambient occlusion',
    icon: Sparkles,
  },
] as const satisfies readonly {
  id: RenderShading
  name: string
  labelKey: string
  detailKey: string
  detail: string
  icon: React.ComponentType<{ className?: string }>
}[]

const EDGE_OPTIONS = [
  {
    id: 'off',
    name: 'Off',
    labelKey: 'toolbar.edgeModes.off',
    detailKey: 'toolbar.edgeModes.offDetail',
    detail: 'No edge lines',
  },
  {
    id: 'soft',
    name: 'Soft',
    labelKey: 'toolbar.edgeModes.soft',
    detailKey: 'toolbar.edgeModes.softDetail',
    detail: 'Faint outlines',
  },
  {
    id: 'strong',
    name: 'Strong',
    labelKey: 'toolbar.edgeModes.strong',
    detailKey: 'toolbar.edgeModes.strongDetail',
    detail: 'Crisp outlines',
  },
] as const satisfies readonly {
  id: EdgeMode
  name: string
  labelKey: string
  detailKey: string
  detail: string
}[]

const SUBMENU_CONTENT_CLASS = 'min-w-56 rounded-xl border-border/45 bg-popover/95 backdrop-blur-xl'
const THEME_SWATCH_ROLES: SceneSurfaceRole[] = ['wall', 'roof', 'floor', 'glazing']
const THEME_SWATCH_FALLBACKS: Record<SceneSurfaceRole, string> = {
  wall: '#dcd6c7',
  floor: '#cfc8b6',
  ceiling: '#e4ded0',
  roof: '#b8ad96',
  joinery: '#c4bba6',
  glazing: '#c8d4dc',
  furnishing: '#d2ccbe',
}

function wallModeConfigKey(wallMode: string): string {
  if (wallMode in wallModeIcons) return wallMode
  return 'cutaway'
}

function sceneThemeLabel(id: string, fallback: string): string {
  return t(`toolbar.themeNames.${id}`, fallback)
}

function ViewModeControl() {
  const viewMode = useEditor((state) => state.viewMode)
  const setViewMode = useEditor((state) => state.setViewMode)

  const viewModes = useMemo(
    () =>
      VIEW_MODE_IDS.map((mode) => ({
        ...mode,
        label: mode.labelKey ? t(mode.labelKey, mode.fallback) : mode.fallback,
      })),
    [],
  )

  return (
    <div className={TOOLBAR_CONTAINER}>
      {viewModes.map((mode) => {
        const isActive = viewMode === mode.id
        return (
          <ToolbarTooltip key={mode.id} label={mode.label}>
            <button
              aria-label={mode.label}
              aria-pressed={isActive}
              className={cn(
                'flex items-center justify-center gap-1.5 px-2.5 font-medium text-xs transition-colors',
                isActive
                  ? 'bg-white/10 text-foreground'
                  : 'text-muted-foreground/70 hover:bg-white/8 hover:text-muted-foreground',
              )}
              onClick={() => setViewMode(mode.id)}
              type="button"
            >
              {mode.icon}
              <span>{mode.label}</span>
            </button>
          </ToolbarTooltip>
        )
      })}
    </div>
  )
}

function CollapseSidebarButton() {
  const isCollapsed = useSidebarStore((state) => state.isCollapsed)
  const setIsCollapsed = useSidebarStore((state) => state.setIsCollapsed)

  const toggle = useCallback(() => {
    setIsCollapsed(!isCollapsed)
  }, [isCollapsed, setIsCollapsed])

  const label = isCollapsed
    ? t('toolbar.expandSidebar', 'Expand sidebar')
    : t('toolbar.collapseSidebar', 'Collapse sidebar')

  return (
    <div className={TOOLBAR_CONTAINER}>
      <ToolbarTooltip label={label}>
        <button aria-label={label} className={TOOLBAR_BTN} onClick={toggle} type="button">
          {isCollapsed ? (
            <ChevronsRight className="h-4 w-4" />
          ) : (
            <ChevronsLeft className="h-4 w-4" />
          )}
        </button>
      </ToolbarTooltip>
    </div>
  )
}

function LevelModeToggle() {
  const levelMode = useViewer((state) => state.levelMode)
  const setLevelMode = useViewer((state) => state.setLevelMode)
  const isDefault = levelMode === 'stacked' || levelMode === 'manual'

  const cycle = () => {
    if (levelMode === 'manual') {
      setLevelMode('stacked')
      return
    }

    const index = levelModeOrder.indexOf(levelMode as (typeof levelModeOrder)[number])
    const next = levelModeOrder[(index + 1) % levelModeOrder.length]
    if (next) setLevelMode(next)
  }

  const modeLabel = levelModeLabel(levelMode)
  const label = t('toolbar.levels', { fallback: 'Levels: {mode}', params: { mode: modeLabel } })

  return (
    <ToolbarTooltip label={label}>
      <button
        className={cn(
          TOOLBAR_BTN,
          'w-auto gap-1.5 px-2.5',
          !isDefault && 'bg-white/10 text-foreground/90',
        )}
        onClick={cycle}
        type="button"
      >
        {levelMode === 'solo' ? (
          <IconifyIcon height={14} icon="lucide:diamond" width={14} />
        ) : levelMode === 'exploded' ? (
          <IconifyIcon height={14} icon="charm:stack-pop" width={14} />
        ) : (
          <IconifyIcon height={14} icon="charm:stack-push" width={14} />
        )}
        <span className="font-medium text-xs">{modeLabel}</span>
      </button>
    </ToolbarTooltip>
  )
}

function WallModeToggle() {
  const wallMode = useViewer((state) => state.wallMode)
  const setWallMode = useViewer((state) => state.setWallMode)
  const mode = wallModeConfigKey(wallMode)
  const label = wallModeLabel(mode)
  const icon = wallModeIcons[mode] ?? wallModeIcons.cutaway!

  const cycle = () => {
    const index = wallModeOrder.indexOf(wallMode as (typeof wallModeOrder)[number])
    const next = wallModeOrder[(index + 1) % wallModeOrder.length]
    if (next) setWallMode(next)
  }

  const tooltipLabel = t('toolbar.walls', { fallback: 'Walls: {mode}', params: { mode: label } })

  return (
    <ToolbarTooltip label={tooltipLabel}>
      <button
        className={cn(
          TOOLBAR_BTN,
          'w-auto gap-1.5 px-2.5',
          wallMode !== 'cutaway'
            ? 'bg-white/10'
            : 'opacity-60 grayscale hover:opacity-100 hover:grayscale-0',
        )}
        onClick={cycle}
        type="button"
      >
        <Image alt="" className="h-4 w-4 object-contain" height={16} src={icon} width={16} />
        <span className="font-medium text-xs">{label}</span>
      </button>
    </ToolbarTooltip>
  )
}

function DisplayMenu() {
  const showGrid = useViewer((state) => state.showGrid)
  const setShowGrid = useViewer((state) => state.setShowGrid)
  const cameraMode = useViewer((state) => state.cameraMode)
  const setCameraMode = useViewer((state) => state.setCameraMode)
  const shading = useViewer((state) => state.shading)
  const setShading = useViewer((state) => state.setShading)
  const edges = useViewer((state) => state.edges)
  const setEdges = useViewer((state) => state.setEdges)
  const shadows = useViewer((state) => state.shadows)
  const setShadows = useViewer((state) => state.setShadows)
  const sceneTheme = useViewer((state) => state.sceneTheme)
  const setSceneTheme = useViewer((state) => state.setSceneTheme)
  const magneticSnap = useEditor((state) => state.magneticSnap)
  const setMagneticSnap = useEditor((state) => state.setMagneticSnap)

  const activeShading =
    SHADING_OPTIONS.find((option) => option.id === shading) ?? SHADING_OPTIONS[0]
  const activeEdges = EDGE_OPTIONS.find((option) => option.id === edges) ?? EDGE_OPTIONS[0]
  const activeTheme = getSceneTheme(sceneTheme)
  const activeThemeLabel = sceneThemeLabel(activeTheme.id, activeTheme.name)

  const keepOpen = (event: Event, fn: () => void) => {
    event.preventDefault()
    fn()
  }

  return (
    <DropdownMenu>
      <ToolbarTooltip label={t('toolbar.displaySettings', 'Display settings')}>
        <DropdownMenuTrigger asChild>
          <button
            aria-label={t('toolbar.displaySettings', 'Display settings')}
            className={cn(TOOLBAR_BTN, 'w-auto gap-1.5 px-2.5 text-foreground/90')}
            type="button"
          >
            <SlidersHorizontal className="h-3.5 w-3.5 shrink-0" />
            <span className="font-medium text-xs">{t('toolbar.display', 'Display')}</span>
          </button>
        </DropdownMenuTrigger>
      </ToolbarTooltip>
      <DropdownMenuContent
        align="end"
        className="w-60 rounded-xl border-border/45 bg-popover/95 backdrop-blur-xl"
        side="bottom"
        sideOffset={8}
      >
        <DropdownMenuItem onSelect={(e) => keepOpen(e, () => setShowGrid(!showGrid))}>
          <Grid2X2 className="h-4 w-4" />
          <span>{t('toolbar.gridLabel', 'Grid')}</span>
          <span className="ml-auto text-muted-foreground text-xs">
            {showGrid ? t('common.on', 'On') : t('common.off', 'Off')}
          </span>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={(e) => keepOpen(e, () => setMagneticSnap(!magneticSnap))}>
          <Magnet className="h-4 w-4" />
          <span>{t('toolbar.magneticSnap', 'Magnetic snap')}</span>
          <span className="ml-auto text-muted-foreground text-xs">
            {magneticSnap ? t('common.on', 'On') : t('common.off', 'Off')}
          </span>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={(e) => keepOpen(e, () => setShadows(!shadows))}>
          <Contrast className="h-4 w-4" />
          <span>{t('toolbar.shadows', 'Shadows')}</span>
          <span className="ml-auto text-muted-foreground text-xs">
            {shadows ? t('common.on', 'On') : t('common.off', 'Off')}
          </span>
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={(e) =>
            keepOpen(e, () =>
              setCameraMode(cameraMode === 'perspective' ? 'orthographic' : 'perspective'),
            )
          }
        >
          <IconifyIcon
            height={16}
            icon={cameraMode === 'perspective' ? 'icon-park-outline:perspective' : 'vaadin:grid'}
            width={16}
          />
          <span>{t('toolbar.camera', 'Camera')}</span>
          <span className="ml-auto text-muted-foreground text-xs">
            {cameraMode === 'perspective'
              ? t('toolbar.perspective', 'Perspective')
              : t('toolbar.orthographic', 'Orthographic')}
          </span>
        </DropdownMenuItem>
        <DropdownMenuSeparator />

        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <activeShading.icon className="h-4 w-4" />
            <span>{t('toolbar.render', 'Render')}</span>
            <span className="ml-auto text-muted-foreground text-xs">
              {t(activeShading.labelKey, activeShading.name)}
            </span>
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className={SUBMENU_CONTENT_CLASS}>
            {SHADING_OPTIONS.map((option) => {
              const OptionIcon = option.icon
              return (
                <DropdownMenuItem
                  key={option.id}
                  onSelect={(e) => keepOpen(e, () => setShading(option.id))}
                >
                  <OptionIcon className="h-4 w-4" />
                  <div className="flex flex-col">
                    <span className="text-foreground">{t(option.labelKey, option.name)}</span>
                    <span className="text-muted-foreground text-xs">
                      {t(option.detailKey, option.detail)}
                    </span>
                  </div>
                  {shading === option.id ? (
                    <Check className="ml-auto h-4 w-4 text-foreground" />
                  ) : null}
                </DropdownMenuItem>
              )
            })}
          </DropdownMenuSubContent>
        </DropdownMenuSub>

        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <PenLine className="h-4 w-4" />
            <span>{t('toolbar.edges', 'Edges')}</span>
            <span className="ml-auto text-muted-foreground text-xs">
              {t(activeEdges.labelKey, activeEdges.name)}
            </span>
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className={SUBMENU_CONTENT_CLASS}>
            {EDGE_OPTIONS.map((option) => (
              <DropdownMenuItem
                key={option.id}
                onSelect={(e) => keepOpen(e, () => setEdges(option.id))}
              >
                <div className="flex flex-col">
                  <span className="text-foreground">{t(option.labelKey, option.name)}</span>
                  <span className="text-muted-foreground text-xs">
                    {t(option.detailKey, option.detail)}
                  </span>
                </div>
                {edges === option.id ? <Check className="ml-auto h-4 w-4 text-foreground" /> : null}
              </DropdownMenuItem>
            ))}
          </DropdownMenuSubContent>
        </DropdownMenuSub>

        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <SwatchBook className="h-4 w-4" />
            <span>{t('toolbar.theme', 'Theme')}</span>
            <span className="ml-auto truncate text-muted-foreground text-xs">
              {activeThemeLabel}
            </span>
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="min-w-48 rounded-xl border-border/45 bg-popover/95 backdrop-blur-xl">
            {SCENE_THEMES.map((themeOption) => {
              const swatches = THEME_SWATCH_ROLES.map(
                (role) => themeOption.clayTints?.[role] ?? THEME_SWATCH_FALLBACKS[role],
              )
              return (
                <DropdownMenuItem
                  key={themeOption.id}
                  onSelect={(e) => keepOpen(e, () => setSceneTheme(themeOption.id))}
                >
                  <span
                    className="grid h-5 w-5 shrink-0 grid-cols-2 overflow-hidden rounded-sm border border-black/10"
                    style={{ backgroundColor: themeOption.background }}
                  >
                    {swatches.map((color, index) => (
                      <span key={`${themeOption.id}-${index}`} style={{ backgroundColor: color }} />
                    ))}
                  </span>
                  <span className="text-foreground">
                    {sceneThemeLabel(themeOption.id, themeOption.name)}
                  </span>
                  {sceneTheme === themeOption.id ? (
                    <Check className="ml-auto h-4 w-4 text-foreground" />
                  ) : null}
                </DropdownMenuItem>
              )
            })}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function WalkthroughButton() {
  const isFirstPersonMode = useEditor((state) => state.isFirstPersonMode)
  const setFirstPersonMode = useEditor((state) => state.setFirstPersonMode)
  const label = t('toolbar.walkthrough', 'Walkthrough')

  const handleClick = useCallback(() => {
    if (isFirstPersonMode) {
      setFirstPersonMode(false)
      return
    }

    flushSync(() => setFirstPersonMode(true))
    requestWalkthroughPointerLock()
  }, [isFirstPersonMode, setFirstPersonMode])

  return (
    <ToolbarTooltip label={label}>
      <button
        className={cn(
          TOOLBAR_BTN,
          isFirstPersonMode && 'bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/20',
        )}
        onClick={handleClick}
        type="button"
      >
        <Footprints className="h-4 w-4" />
      </button>
    </ToolbarTooltip>
  )
}

function PreviewButton() {
  const tooltipLabel = t('toolbar.previewMode', 'Preview mode')
  const buttonLabel = t('toolbar.preview', 'Preview')

  return (
    <ToolbarTooltip label={tooltipLabel}>
      <button
        className="flex items-center gap-1.5 px-2.5 font-medium text-muted-foreground/80 text-xs transition-colors hover:bg-white/8 hover:text-foreground/90"
        onClick={() => useEditor.getState().setPreviewMode(true)}
        type="button"
      >
        <Eye className="h-3.5 w-3.5 shrink-0" />
        <span>{buttonLabel}</span>
      </button>
    </ToolbarTooltip>
  )
}

export function CommunityViewerToolbarLeft() {
  return (
    <>
      <CollapseSidebarButton />
      <ViewModeControl />
    </>
  )
}

export function CommunityViewerToolbarRight() {
  return (
    <div className={TOOLBAR_CONTAINER}>
      <LevelModeToggle />
      <WallModeToggle />
      <div className="my-1.5 w-px bg-border/50" />
      <DisplayMenu />
      <div className="my-1.5 w-px bg-border/50" />
      <WalkthroughButton />
      <PreviewButton />
    </div>
  )
}

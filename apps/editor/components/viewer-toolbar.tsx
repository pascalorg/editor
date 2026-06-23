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
  CLAY_PALETTE,
  type EdgeMode,
  getSceneTheme,
  SCENE_THEMES,
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
  EyeOff,
  Footprints,
  Grid2X2,
  Magnet,
  PenLine,
  SlidersHorizontal,
  Sparkles,
  SwatchBook,
} from 'lucide-react'
import Image from 'next/image'
import { type ReactNode, useCallback } from 'react'
import { flushSync } from 'react-dom'
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

const VIEW_MODES: { id: ViewMode; label: string; icon: React.ReactNode }[] = [
  {
    id: '3d',
    label: '3D',
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
    label: '2D',
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
    label: 'Split',
    icon: <Columns2 className="h-3 w-3" />,
  },
]

const levelModeOrder = ['stacked', 'exploded', 'solo'] as const
const levelModeLabels: Record<string, string> = {
  manual: 'Stack',
  stacked: 'Stack',
  exploded: 'Exploded',
  solo: 'Solo',
}

const wallModeOrder = ['cutaway', 'up', 'down', 'translucent'] as const
const wallModeConfig: Record<string, { icon: string; label: string }> = {
  up: { icon: '/icons/room.webp', label: 'Full height' },
  cutaway: { icon: '/icons/wallcut.webp', label: 'Cutaway' },
  down: { icon: '/icons/walllow.webp', label: 'Low' },
  translucent: { icon: '/icons/wall.webp', label: 'Translucent' },
}

const SHADING_OPTIONS = [
  { id: 'solid', name: 'Solid', detail: 'Flat and fast — no ambient occlusion', icon: Box },
  { id: 'rendered', name: 'Rendered', detail: 'Full ambient occlusion', icon: Sparkles },
] as const

function ViewModeControl() {
  const viewMode = useEditor((state) => state.viewMode)
  const setViewMode = useEditor((state) => state.setViewMode)

  return (
    <div className={TOOLBAR_CONTAINER}>
      {VIEW_MODES.map((mode) => {
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

  return (
    <div className={TOOLBAR_CONTAINER}>
      <ToolbarTooltip label={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
        <button
          aria-label={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          className={TOOLBAR_BTN}
          onClick={toggle}
          type="button"
        >
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

  const label = `Levels: ${levelMode === 'manual' ? 'Manual' : (levelModeLabels[levelMode] ?? 'Stack')}`

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
        <span className="font-medium text-xs">{levelModeLabels[levelMode] ?? 'Stack'}</span>
      </button>
    </ToolbarTooltip>
  )
}

function WallModeToggle() {
  const wallMode = useViewer((state) => state.wallMode)
  const setWallMode = useViewer((state) => state.setWallMode)
  const config = wallModeConfig[wallMode] ?? wallModeConfig.cutaway!

  const cycle = () => {
    const index = wallModeOrder.indexOf(wallMode as (typeof wallModeOrder)[number])
    const next = wallModeOrder[(index + 1) % wallModeOrder.length]
    if (next) setWallMode(next)
  }

  return (
    <ToolbarTooltip label={`Walls: ${config.label}`}>
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
        <Image alt="" className="h-4 w-4 object-contain" height={16} src={config.icon} width={16} />
        <span className="font-medium text-xs">{config.label}</span>
      </button>
    </ToolbarTooltip>
  )
}

// One dropdown that gathers every "how the scene looks" control: grid, shadows,
// camera projection, units, render mode, edges and scene theme.

const EDGE_OPTIONS = [
  { id: 'off', name: 'Off', detail: 'No edge lines' },
  { id: 'soft', name: 'Soft', detail: 'Faint outline of major creases' },
  { id: 'strong', name: 'Strong', detail: 'Crisp, opaque edge lines' },
] as const satisfies readonly { id: EdgeMode; name: string; detail: string }[]

const SUBMENU_CONTENT_CLASS = 'min-w-56 rounded-xl border-border/45 bg-popover/95 backdrop-blur-xl'

function DisplayMenu() {
  const showGrid = useViewer((state) => state.showGrid)
  const setShowGrid = useViewer((state) => state.setShowGrid)
  const unit = useViewer((state) => state.unit)
  const setUnit = useViewer((state) => state.setUnit)
  const cameraMode = useViewer((state) => state.cameraMode)
  const setCameraMode = useViewer((state) => state.setCameraMode)
  const shading = useViewer((state) => state.shading)
  const setShading = useViewer((state) => state.setShading)
  const sceneTheme = useViewer((state) => state.sceneTheme)
  const setSceneTheme = useViewer((state) => state.setSceneTheme)
  const edges = useViewer((state) => state.edges)
  const setEdges = useViewer((state) => state.setEdges)
  const shadows = useViewer((state) => state.shadows)
  const setShadows = useViewer((state) => state.setShadows)
  const magneticSnap = useEditor((state) => state.magneticSnap)
  const setMagneticSnap = useEditor((state) => state.setMagneticSnap)

  const activeShading =
    SHADING_OPTIONS.find((option) => option.id === shading) ?? SHADING_OPTIONS[0]
  const activeEdges = EDGE_OPTIONS.find((option) => option.id === edges) ?? EDGE_OPTIONS[0]
  const activeTheme = getSceneTheme(sceneTheme)

  // Keep the menu open when flipping a toggle.
  const keepOpen = (event: Event, fn: () => void) => {
    event.preventDefault()
    fn()
  }

  return (
    <DropdownMenu>
      <ToolbarTooltip label="Display settings">
        <DropdownMenuTrigger asChild>
          <button
            aria-label="Display settings"
            className={cn(TOOLBAR_BTN, 'w-auto gap-1.5 px-2.5 text-foreground/90')}
            type="button"
          >
            <SlidersHorizontal className="h-3.5 w-3.5 shrink-0" />
            <span className="font-medium text-xs">Display</span>
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
          <span>Grid</span>
          {showGrid ? (
            <Eye className="ml-auto h-4 w-4 text-foreground" />
          ) : (
            <EyeOff className="ml-auto h-4 w-4 text-muted-foreground" />
          )}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={(e) => keepOpen(e, () => setMagneticSnap(!magneticSnap))}>
          <Magnet className="h-4 w-4" />
          <span>Magnetic snap</span>
          <span className="ml-auto text-muted-foreground text-xs">
            {magneticSnap ? 'On' : 'Off'}
          </span>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={(e) => keepOpen(e, () => setShadows(!shadows))}>
          <Contrast className="h-4 w-4" />
          <span>Shadows</span>
          <span className="ml-auto text-muted-foreground text-xs">{shadows ? 'On' : 'Off'}</span>
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
          <span>Camera</span>
          <span className="ml-auto text-muted-foreground text-xs">
            {cameraMode === 'perspective' ? 'Perspective' : 'Orthographic'}
          </span>
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={(e) => keepOpen(e, () => setUnit(unit === 'metric' ? 'imperial' : 'metric'))}
        >
          <span className="flex h-4 w-4 items-center justify-center font-semibold text-[10px]">
            {unit === 'metric' ? 'm' : 'ft'}
          </span>
          <span>Units</span>
          <span className="ml-auto text-muted-foreground text-xs">
            {unit === 'metric' ? 'Metric' : 'Imperial'}
          </span>
        </DropdownMenuItem>

        <DropdownMenuSeparator />

        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <activeShading.icon className="h-4 w-4" />
            <span>Render</span>
            <span className="ml-auto text-muted-foreground text-xs">{activeShading.name}</span>
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className={SUBMENU_CONTENT_CLASS}>
            {SHADING_OPTIONS.map((option) => {
              const OptionIcon = option.icon
              return (
                <DropdownMenuItem key={option.id} onSelect={() => setShading(option.id)}>
                  <OptionIcon className="h-4 w-4" />
                  <div className="flex flex-col">
                    <span className="text-foreground">{option.name}</span>
                    <span className="text-muted-foreground text-xs">{option.detail}</span>
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
            <span>Edges</span>
            <span className="ml-auto text-muted-foreground text-xs">{activeEdges.name}</span>
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className={SUBMENU_CONTENT_CLASS}>
            {EDGE_OPTIONS.map((option) => (
              <DropdownMenuItem key={option.id} onSelect={() => setEdges(option.id)}>
                <div className="flex flex-col">
                  <span className="text-foreground">{option.name}</span>
                  <span className="text-muted-foreground text-xs">{option.detail}</span>
                </div>
                {edges === option.id ? <Check className="ml-auto h-4 w-4 text-foreground" /> : null}
              </DropdownMenuItem>
            ))}
          </DropdownMenuSubContent>
        </DropdownMenuSub>

        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <SwatchBook className="h-4 w-4" />
            <span>Theme</span>
            <span className="ml-auto truncate text-muted-foreground text-xs">
              {activeTheme.name}
            </span>
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="min-w-48 rounded-xl border-border/45 bg-popover/95 backdrop-blur-xl">
            {SCENE_THEMES.map((theme) => {
              const swatches = (['wall', 'roof', 'floor', 'glazing'] as const).map(
                (role) => theme.clayTints?.[role] ?? CLAY_PALETTE[role],
              )
              return (
                <DropdownMenuItem key={theme.id} onSelect={() => setSceneTheme(theme.id)}>
                  <span
                    className="grid h-5 w-5 shrink-0 grid-cols-2 overflow-hidden rounded-sm border border-black/10"
                    style={{ backgroundColor: theme.background }}
                  >
                    {swatches.map((color, index) => (
                      <span key={`${theme.id}-${index}`} style={{ backgroundColor: color }} />
                    ))}
                  </span>
                  <span className="text-foreground">{theme.name}</span>
                  {sceneTheme === theme.id ? (
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
  const handleClick = useCallback(() => {
    if (isFirstPersonMode) {
      setFirstPersonMode(false)
      return
    }

    flushSync(() => setFirstPersonMode(true))
    requestWalkthroughPointerLock()
  }, [isFirstPersonMode, setFirstPersonMode])

  return (
    <ToolbarTooltip label="Walkthrough">
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
  return (
    <ToolbarTooltip label="Preview mode">
      <button
        className="flex items-center gap-1.5 px-2.5 font-medium text-muted-foreground/80 text-xs transition-colors hover:bg-white/8 hover:text-foreground/90"
        onClick={() => useEditor.getState().setPreviewMode(true)}
        type="button"
      >
        <Eye className="h-3.5 w-3.5 shrink-0" />
        <span>Preview</span>
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

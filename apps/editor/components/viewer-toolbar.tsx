'use client'

import { Icon as IconifyIcon } from '@iconify/react'
import { useEditor, useSidebarStore, type ViewMode } from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import {
  ChevronsLeft,
  ChevronsRight,
  Columns2,
  Eye,
  EyeOff,
  Footprints,
  Grid2X2,
  Moon,
  Sun,
} from 'lucide-react'
import Image from 'next/image'
import { type ReactNode, useCallback, useMemo } from 'react'
import { t } from '@/i18n'
import { cn } from '@/lib/utils'
import { Tooltip, TooltipContent, TooltipTrigger } from './toolbar-tooltip'

const TOOLBAR_CONTAINER =
  'inline-flex h-8 items-stretch overflow-hidden rounded-xl border border-border bg-background/90 shadow-2xl backdrop-blur-md'

const TOOLBAR_BTN =
  'flex w-8 items-center justify-center text-muted-foreground/80 transition-colors hover:bg-white/8 hover:text-foreground/90'

function ToolbarTooltip({ children, label }: { children: ReactNode; label: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  )
}

const VIEW_MODE_IDS: { id: ViewMode; labelKey?: string; fallback: string; icon: React.ReactNode }[] =
  [
    {
      id: '3d',
      fallback: '3D',
      icon: (
        <Image
          alt=""
          className="h-3.5 w-3.5 object-contain"
          height={14}
          src="/icons/building.png"
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
          src="/icons/blueprint.png"
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
  up: '/icons/room.png',
  cutaway: '/icons/wallcut.png',
  down: '/icons/walllow.png',
}

function wallModeConfigKey(wallMode: string): string {
  if (wallMode in wallModeIcons) return wallMode
  return 'cutaway'
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

function GridVisibilityToggle() {
  const showGrid = useViewer((state) => state.showGrid)
  const setShowGrid = useViewer((state) => state.setShowGrid)

  const stateLabel = showGrid ? t('common.visible', 'Visible') : t('common.hidden', 'Hidden')
  const label = t('toolbar.grid', { fallback: 'Grid: {state}', params: { state: stateLabel } })

  return (
    <ToolbarTooltip label={label}>
      <button
        aria-label={label}
        aria-pressed={showGrid}
        className={cn(
          TOOLBAR_BTN,
          'w-auto gap-1.5 px-2.5',
          showGrid
            ? 'bg-white/10 text-foreground/90'
            : 'opacity-60 grayscale hover:opacity-100 hover:grayscale-0',
        )}
        onClick={() => setShowGrid(!showGrid)}
        type="button"
      >
        <Grid2X2 className="h-3.5 w-3.5" />
        {showGrid ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
      </button>
    </ToolbarTooltip>
  )
}

function UnitToggle() {
  const unit = useViewer((state) => state.unit)
  const setUnit = useViewer((state) => state.setUnit)

  const label =
    unit === 'metric' ? t('toolbar.metric', 'Metric (m)') : t('toolbar.imperial', 'Imperial (ft)')

  return (
    <ToolbarTooltip label={label}>
      <button
        className={TOOLBAR_BTN}
        onClick={() => setUnit(unit === 'metric' ? 'imperial' : 'metric')}
        type="button"
      >
        <span className="font-semibold text-[10px]">{unit === 'metric' ? 'm' : 'ft'}</span>
      </button>
    </ToolbarTooltip>
  )
}

function ThemeToggle() {
  const theme = useViewer((state) => state.theme)
  const setTheme = useViewer((state) => state.setTheme)

  const label = theme === 'dark' ? t('toolbar.dark', 'Dark') : t('toolbar.light', 'Light')

  return (
    <ToolbarTooltip label={label}>
      <button
        className={cn(TOOLBAR_BTN, theme === 'dark' ? 'text-indigo-400/70' : 'text-amber-400/70')}
        onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
        type="button"
      >
        {theme === 'dark' ? <Moon className="h-3.5 w-3.5" /> : <Sun className="h-3.5 w-3.5" />}
      </button>
    </ToolbarTooltip>
  )
}

function CameraModeToggle() {
  const cameraMode = useViewer((state) => state.cameraMode)
  const setCameraMode = useViewer((state) => state.setCameraMode)

  const label =
    cameraMode === 'perspective'
      ? t('toolbar.perspective', 'Perspective')
      : t('toolbar.orthographic', 'Orthographic')

  return (
    <ToolbarTooltip label={label}>
      <button
        className={cn(
          TOOLBAR_BTN,
          cameraMode === 'orthographic' && 'bg-white/10 text-foreground/90',
        )}
        onClick={() => setCameraMode(cameraMode === 'perspective' ? 'orthographic' : 'perspective')}
        type="button"
      >
        {cameraMode === 'perspective' ? (
          <IconifyIcon height={16} icon="icon-park-outline:perspective" width={16} />
        ) : (
          <IconifyIcon height={16} icon="vaadin:grid" width={16} />
        )}
      </button>
    </ToolbarTooltip>
  )
}

function WalkthroughButton() {
  const isFirstPersonMode = useEditor((state) => state.isFirstPersonMode)
  const setFirstPersonMode = useEditor((state) => state.setFirstPersonMode)

  const label = t('toolbar.walkthrough', 'Walkthrough')

  return (
    <ToolbarTooltip label={label}>
      <button
        className={cn(
          TOOLBAR_BTN,
          isFirstPersonMode && 'bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/20',
        )}
        onClick={() => setFirstPersonMode(!isFirstPersonMode)}
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
      <GridVisibilityToggle />
      <div className="my-1.5 w-px bg-border/50" />
      <UnitToggle />
      <ThemeToggle />
      <CameraModeToggle />
      <div className="my-1.5 w-px bg-border/50" />
      <WalkthroughButton />
      <PreviewButton />
    </div>
  )
}

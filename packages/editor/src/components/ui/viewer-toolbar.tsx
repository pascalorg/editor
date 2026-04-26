'use client'

import { emitter } from '@pascal-app/core'
import { Icon as IconifyIcon } from '@iconify/react'
import { useViewer } from '@pascal-app/viewer'
import {
  Bot,
  Check,
  ChevronsLeft,
  ChevronsRight,
  Columns2,
  Eye,
  Footprints,
  Moon,
  Shield,
  Sun,
} from 'lucide-react'
import { useCallback } from 'react'
import { cn } from '../../lib/utils'
import useEditor from '../../store/use-editor'
import useNavigation, {
  type NavigationRobotModel,
  type NavigationRobotMode,
} from '../../store/use-navigation'
import type { GridSnapStep, ViewMode } from '../../store/use-editor'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './primitives/dropdown-menu'
import { useSidebarStore } from './primitives/sidebar'
import { Tooltip, TooltipContent, TooltipTrigger } from './primitives/tooltip'

// ── Shared styles ───────────────────────────────────────────────────────────

/** Container for a group of buttons — no padding, overflow-hidden clips children flush. */
const TOOLBAR_CONTAINER =
  'inline-flex h-8 items-stretch overflow-hidden rounded-xl border border-border bg-background/90 shadow-2xl backdrop-blur-md'

/** Ghost button inside a container — flush edges, no individual border/radius. */
const TOOLBAR_BTN =
  'flex items-center justify-center w-8 text-muted-foreground/80 transition-colors hover:bg-white/8 hover:text-foreground/90'

// ── View mode segmented control ─────────────────────────────────────────────

const VIEW_MODES: { id: ViewMode; label: string; icon: React.ReactNode }[] = [
  {
    id: '3d',
    label: '3D',
    icon: <img alt="" className="h-3.5 w-3.5 object-contain" src="/icons/building.png" />,
  },
  {
    id: '2d',
    label: '2D',
    icon: <img alt="" className="h-3.5 w-3.5 object-contain" src="/icons/blueprint.png" />,
  },
  {
    id: 'split',
    label: 'Split',
    icon: <Columns2 className="h-3 w-3" />,
  },
]

function ViewModeControl() {
  const viewMode = useEditor((s) => s.viewMode)
  const setViewMode = useEditor((s) => s.setViewMode)

  return (
    <div className={TOOLBAR_CONTAINER}>
      {VIEW_MODES.map((mode) => {
        const isActive = viewMode === mode.id
        return (
          <button
            className={cn(
              'flex items-center justify-center gap-1.5 px-2.5 font-medium text-xs transition-colors',
              isActive
                ? 'bg-white/10 text-foreground'
                : 'text-muted-foreground/70 hover:bg-white/8 hover:text-muted-foreground',
            )}
            key={mode.id}
            onClick={() => setViewMode(mode.id)}
            type="button"
          >
            {mode.icon}
            <span>{mode.label}</span>
          </button>
        )
      })}
    </div>
  )
}

// ── Collapse sidebar button ─────────────────────────────────────────────────

function CollapseSidebarButton() {
  const isCollapsed = useSidebarStore((s) => s.isCollapsed)
  const setIsCollapsed = useSidebarStore((s) => s.setIsCollapsed)

  const toggle = useCallback(() => {
    setIsCollapsed(!isCollapsed)
  }, [isCollapsed, setIsCollapsed])

  return (
    <div className={TOOLBAR_CONTAINER}>
      <button
        className={TOOLBAR_BTN}
        onClick={toggle}
        title={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        type="button"
      >
        {isCollapsed ? <ChevronsRight className="h-4 w-4" /> : <ChevronsLeft className="h-4 w-4" />}
      </button>
    </div>
  )
}

// ── Right toolbar buttons ───────────────────────────────────────────────────

function WalkthroughButton() {
  const isFirstPersonMode = useEditor((s) => s.isFirstPersonMode)
  const setFirstPersonMode = useEditor((s) => s.setFirstPersonMode)

  const toggle = () => {
    setFirstPersonMode(!isFirstPersonMode)
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          className={cn(
            TOOLBAR_BTN,
            isFirstPersonMode && 'bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/20',
          )}
          onClick={toggle}
          type="button"
        >
          <Footprints className="h-4 w-4" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom">Walkthrough</TooltipContent>
    </Tooltip>
  )
}

const ROBOT_MODE_OPTIONS: Array<{ label: string; mode: NavigationRobotMode }> = [
  { label: 'Manual mode', mode: 'normal' },
  { label: 'Task mode', mode: 'task' },
]

const ROBOT_MODEL_LABELS: Record<NavigationRobotModel, string> = {
  armored: 'Armored robot',
  pascal: 'Pascal robot',
}

function RobotModeButton() {
  const robotModel = useNavigation((state) => state.robotModel)
  const robotMode = useNavigation((state) => state.robotMode)
  const setRobotModel = useNavigation((state) => state.setRobotModel)
  const setRobotMode = useNavigation((state) => state.setRobotMode)

  const activateRobotMode = useCallback(
    (mode: NavigationRobotMode) => {
      emitter.emit('tool:cancel')
      const viewerState = useViewer.getState()
      viewerState.setHoveredId(null)
      viewerState.setPreviewSelectedIds([])
      viewerState.setSelection({ selectedIds: [], zoneId: null })
      viewerState.outliner.selectedObjects.length = 0
      viewerState.outliner.hoveredObjects.length = 0

      const editorState = useEditor.getState()
      editorState.setEditingHole(null)
      editorState.setFloorplanSelectionTool('click')
      editorState.setMode('select')
      editorState.setSelectedReferenceId(null)
      editorState.setTool(null)

      setRobotMode(mode)
    },
    [setRobotMode],
  )

  const toggleRobotModel = useCallback(() => {
    setRobotModel(robotModel === 'pascal' ? 'armored' : 'pascal')
  }, [robotModel, setRobotModel])

  const nextRobotModel = robotModel === 'pascal' ? 'armored' : 'pascal'
  const tooltipLabel =
    robotMode === 'normal'
      ? `Robot: manual mode (${ROBOT_MODEL_LABELS[robotModel]})`
      : robotMode === 'task'
        ? `Robot: task mode (${ROBOT_MODEL_LABELS[robotModel]})`
        : `Robot (${ROBOT_MODEL_LABELS[robotModel]})`

  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <button
              className={cn(
                TOOLBAR_BTN,
                robotMode && 'bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/20',
              )}
              type="button"
            >
              <Bot className="h-4 w-4" />
            </button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="bottom">{tooltipLabel}</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="center" side="bottom">
        {ROBOT_MODE_OPTIONS.map((option) => {
          const isActive = robotMode === option.mode
          return (
            <DropdownMenuItem key={option.mode} onSelect={() => activateRobotMode(option.mode)}>
              <span className="flex min-w-28 items-center justify-between gap-3">
                <span>{option.label}</span>
                {isActive ? <Check className="h-3.5 w-3.5" /> : <span className="h-3.5 w-3.5" />}
              </span>
            </DropdownMenuItem>
          )
        })}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={toggleRobotModel}>
          <span className="flex min-w-28 items-center justify-between gap-3">
            <span>{ROBOT_MODEL_LABELS[nextRobotModel]}</span>
            {nextRobotModel === 'armored' ? (
              <Shield className="h-3.5 w-3.5" />
            ) : (
              <Bot className="h-3.5 w-3.5" />
            )}
          </span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function UnitToggle() {
  const unit = useViewer((s) => s.unit)
  const setUnit = useViewer((s) => s.setUnit)

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          className={TOOLBAR_BTN}
          onClick={() => setUnit(unit === 'metric' ? 'imperial' : 'metric')}
          type="button"
        >
          <span className="font-semibold text-[10px]">{unit === 'metric' ? 'm' : 'ft'}</span>
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        {unit === 'metric' ? 'Metric (m)' : 'Imperial (ft)'}
      </TooltipContent>
    </Tooltip>
  )
}

function ThemeToggle() {
  const theme = useViewer((s) => s.theme)
  const setTheme = useViewer((s) => s.setTheme)

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          className={cn(TOOLBAR_BTN, theme === 'dark' ? 'text-indigo-400/60' : 'text-amber-400/60')}
          onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          type="button"
        >
          {theme === 'dark' ? <Moon className="h-3.5 w-3.5" /> : <Sun className="h-3.5 w-3.5" />}
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{theme === 'dark' ? 'Dark' : 'Light'}</TooltipContent>
    </Tooltip>
  )
}

// ── Level mode toggle ───────────────────────────────────────────────────────

const levelModeOrder = ['stacked', 'exploded', 'solo'] as const
const levelModeLabels: Record<string, string> = {
  manual: 'Stack',
  stacked: 'Stack',
  exploded: 'Exploded',
  solo: 'Solo',
}

const gridSnapOrder: GridSnapStep[] = [0.5, 0.25, 0.1, 0.05]
const gridSnapLabels: Record<GridSnapStep, string> = {
  0.5: '0.50',
  0.25: '0.25',
  0.1: '0.10',
  0.05: '0.05',
}

function formatGridSnapStep(step: GridSnapStep): string {
  return gridSnapLabels[step]
}

function LevelModeToggle() {
  const levelMode = useViewer((s) => s.levelMode)
  const setLevelMode = useViewer((s) => s.setLevelMode)

  const cycle = () => {
    if (levelMode === 'manual') {
      setLevelMode('stacked')
      return
    }
    const idx = levelModeOrder.indexOf(levelMode as (typeof levelModeOrder)[number])
    const next = levelModeOrder[(idx + 1) % levelModeOrder.length]
    if (next) setLevelMode(next)
  }

  const isDefault = levelMode === 'stacked' || levelMode === 'manual'

  return (
    <Tooltip>
      <TooltipTrigger asChild>
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
      </TooltipTrigger>
      <TooltipContent side="bottom">
        Levels: {levelMode === 'manual' ? 'Manual' : levelModeLabels[levelMode]}
      </TooltipContent>
    </Tooltip>
  )
}

function GridSnapToggle() {
  const gridSnapStep = useEditor((s) => s.gridSnapStep)
  const setGridSnapStep = useEditor((s) => s.setGridSnapStep)

  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <button className={cn(TOOLBAR_BTN, 'w-auto gap-1.5 px-2.5')} type="button">
              <IconifyIcon height={14} icon="lucide:grid-2x2" width={14} />
              <span className="font-medium text-xs">{formatGridSnapStep(gridSnapStep)}</span>
            </button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="bottom">Grid snap: {formatGridSnapStep(gridSnapStep)}</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="center" side="bottom">
        {gridSnapOrder.map((step) => {
          const isActive = step === gridSnapStep
          return (
            <DropdownMenuItem key={step} onSelect={() => setGridSnapStep(step)}>
              <span className="flex min-w-12 items-center justify-between gap-3">
                <span>{formatGridSnapStep(step)}</span>
                {isActive ? <Check className="h-3.5 w-3.5" /> : <span className="h-3.5 w-3.5" />}
              </span>
            </DropdownMenuItem>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

// ── Wall mode toggle ────────────────────────────────────────────────────────

const wallModeOrder = ['cutaway', 'up', 'down'] as const
const wallModeConfig: Record<string, { icon: string; label: string }> = {
  up: { icon: '/icons/room.png', label: 'Full height' },
  cutaway: { icon: '/icons/wallcut.png', label: 'Cutaway' },
  down: { icon: '/icons/walllow.png', label: 'Low' },
}

function WallModeToggle() {
  const wallMode = useViewer((s) => s.wallMode)
  const setWallMode = useViewer((s) => s.setWallMode)

  const cycle = () => {
    const idx = wallModeOrder.indexOf(wallMode as (typeof wallModeOrder)[number])
    const next = wallModeOrder[(idx + 1) % wallModeOrder.length]
    if (next) setWallMode(next)
  }

  const config = wallModeConfig[wallMode] ?? wallModeConfig.cutaway!

  return (
    <Tooltip>
      <TooltipTrigger asChild>
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
          <img alt={config.label} className="h-4 w-4 object-contain" src={config.icon} />
          <span className="font-medium text-xs">{config.label}</span>
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom">Walls: {config.label}</TooltipContent>
    </Tooltip>
  )
}

// ── Camera mode toggle ──────────────────────────────────────────────────────

function CameraModeToggle() {
  const cameraMode = useViewer((s) => s.cameraMode)
  const setCameraMode = useViewer((s) => s.setCameraMode)

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          className={cn(
            TOOLBAR_BTN,
            cameraMode === 'orthographic' && 'bg-white/10 text-foreground/90',
          )}
          onClick={() =>
            setCameraMode(cameraMode === 'perspective' ? 'orthographic' : 'perspective')
          }
          type="button"
        >
          {cameraMode === 'perspective' ? (
            <IconifyIcon height={16} icon="icon-park-outline:perspective" width={16} />
          ) : (
            <IconifyIcon height={16} icon="vaadin:grid" width={16} />
          )}
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        {cameraMode === 'perspective' ? 'Perspective' : 'Orthographic'}
      </TooltipContent>
    </Tooltip>
  )
}

function PreviewButton() {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          className="flex items-center gap-1.5 px-2.5 font-medium text-muted-foreground/80 text-xs transition-colors hover:bg-white/8 hover:text-foreground/90"
          onClick={() => useEditor.getState().setPreviewMode(true)}
          type="button"
        >
          <Eye className="h-3.5 w-3.5 shrink-0" />
          <span>Preview</span>
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom">Preview mode</TooltipContent>
    </Tooltip>
  )
}

// ── Composed toolbar sections ───────────────────────────────────────────────

export function ViewerToolbarLeft() {
  return (
    <>
      <CollapseSidebarButton />
      <ViewModeControl />
    </>
  )
}

export function ViewerToolbarRight() {
  return (
    <div className={TOOLBAR_CONTAINER}>
      <LevelModeToggle />
      <WallModeToggle />
      <GridSnapToggle />
      <div className="my-1.5 w-px bg-border/50" />
      <UnitToggle />
      <ThemeToggle />
      <CameraModeToggle />
      <div className="my-1.5 w-px bg-border/50" />
      <WalkthroughButton />
      <RobotModeButton />
      <PreviewButton />
    </div>
  )
}

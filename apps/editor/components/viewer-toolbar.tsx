'use client'

import { Icon as IconifyIcon } from '@iconify/react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
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
  FileUp,
  Footprints,
  Grid2X2,
  PenLine,
  Sparkles,
  SwatchBook,
} from 'lucide-react'
import Image from 'next/image'
import { type ReactNode, useCallback, useState } from 'react'
import { ImportDxfTool } from '@/components/tools/ImportDxfTool'
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

const VIEW_MODES: { id: ViewMode; label: string; icon: React.ReactNode }[] = [
  {
    id: '3d',
    label: '3D',
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
    label: '2D',
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

const wallModeOrder = ['cutaway', 'up', 'down'] as const
const wallModeConfig: Record<string, { icon: string; label: string }> = {
  up: { icon: '/icons/room.png', label: 'Full height' },
  cutaway: { icon: '/icons/wallcut.png', label: 'Cutaway' },
  down: { icon: '/icons/walllow.png', label: 'Low' },
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

function RenderModeMenu() {
  const shading = useViewer((state) => state.shading)
  const setShading = useViewer((state) => state.setShading)
  const active = SHADING_OPTIONS.find((option) => option.id === shading) ?? SHADING_OPTIONS[0]
  const ActiveIcon = active.icon

  return (
    <DropdownMenu>
      <ToolbarTooltip label={`Render: ${active.name}`}>
        <DropdownMenuTrigger asChild>
          <button
            aria-label={`Render: ${active.name}`}
            className={cn(
              TOOLBAR_BTN,
              'w-auto gap-1.5 px-2.5',
              shading === 'rendered' && 'bg-white/10 text-foreground/90',
            )}
            type="button"
          >
            <ActiveIcon className="h-3.5 w-3.5" />
            <span className="font-medium text-xs">{active.name}</span>
          </button>
        </DropdownMenuTrigger>
      </ToolbarTooltip>
      <DropdownMenuContent align="center" className="min-w-56" side="bottom">
        {SHADING_OPTIONS.map((option) => {
          const OptionIcon = option.icon
          return (
            <DropdownMenuItem key={option.id} onSelect={() => setShading(option.id)}>
              <OptionIcon className="h-4 w-4" />
              <div className="flex flex-col">
                <span className="text-foreground">{option.name}</span>
                <span className="text-muted-foreground text-xs">{option.detail}</span>
              </div>
              {shading === option.id ? <Check className="ml-auto h-4 w-4 text-foreground" /> : null}
            </DropdownMenuItem>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function SceneThemeMenu() {
  const sceneTheme = useViewer((state) => state.sceneTheme)
  const setSceneTheme = useViewer((state) => state.setSceneTheme)
  const active = getSceneTheme(sceneTheme)

  return (
    <DropdownMenu>
      <ToolbarTooltip label={`Scene theme: ${active.name}`}>
        <DropdownMenuTrigger asChild>
          <button
            aria-label={`Scene theme: ${active.name}`}
            className={cn(TOOLBAR_BTN, 'w-28 gap-1.5 px-2.5 text-foreground/90')}
            type="button"
          >
            <SwatchBook className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate font-medium text-xs">{active.name}</span>
          </button>
        </DropdownMenuTrigger>
      </ToolbarTooltip>
      <DropdownMenuContent align="center" className="min-w-48" side="bottom">
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
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

const EDGE_OPTIONS = [
  { id: 'off', name: 'Off', detail: 'No edge lines' },
  { id: 'soft', name: 'Soft', detail: 'Faint outline of major creases' },
  { id: 'strong', name: 'Strong', detail: 'Crisp, opaque edge lines' },
] as const satisfies readonly { id: EdgeMode; name: string; detail: string }[]

function EdgesMenu() {
  const edges = useViewer((state) => state.edges)
  const setEdges = useViewer((state) => state.setEdges)
  const active = EDGE_OPTIONS.find((option) => option.id === edges) ?? EDGE_OPTIONS[0]

  return (
    <DropdownMenu>
      <ToolbarTooltip label={`Edges: ${active.name}`}>
        <DropdownMenuTrigger asChild>
          <button
            aria-label={`Edges: ${active.name}`}
            className={cn(TOOLBAR_BTN, edges !== 'off' && 'bg-white/10 text-foreground/90')}
            type="button"
          >
            <PenLine className="h-4 w-4" />
          </button>
        </DropdownMenuTrigger>
      </ToolbarTooltip>
      <DropdownMenuContent align="center" className="min-w-56" side="bottom">
        {EDGE_OPTIONS.map((option) => (
          <DropdownMenuItem key={option.id} onSelect={() => setEdges(option.id)}>
            <div className="flex flex-col">
              <span className="text-foreground">{option.name}</span>
              <span className="text-muted-foreground text-xs">{option.detail}</span>
            </div>
            {edges === option.id ? <Check className="ml-auto h-4 w-4 text-foreground" /> : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function GridVisibilityToggle() {
  const showGrid = useViewer((state) => state.showGrid)
  const setShowGrid = useViewer((state) => state.setShowGrid)

  return (
    <ToolbarTooltip label={`Grid: ${showGrid ? 'Visible' : 'Hidden'}`}>
      <button
        aria-label={`Grid: ${showGrid ? 'Visible' : 'Hidden'}`}
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

function ShadowsToggle() {
  const shadows = useViewer((state) => state.shadows)
  const setShadows = useViewer((state) => state.setShadows)

  return (
    <ToolbarTooltip label={`Shadows: ${shadows ? 'On' : 'Off'}`}>
      <button
        aria-label={`Shadows: ${shadows ? 'On' : 'Off'}`}
        aria-pressed={shadows}
        className={cn(
          TOOLBAR_BTN,
          shadows
            ? 'bg-white/10 text-foreground/90'
            : 'opacity-60 grayscale hover:opacity-100 hover:grayscale-0',
        )}
        onClick={() => setShadows(!shadows)}
        type="button"
      >
        <Contrast className="h-3.5 w-3.5" />
      </button>
    </ToolbarTooltip>
  )
}

function UnitToggle() {
  const unit = useViewer((state) => state.unit)
  const setUnit = useViewer((state) => state.setUnit)

  return (
    <ToolbarTooltip label={unit === 'metric' ? 'Metric (m)' : 'Imperial (ft)'}>
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

function CameraModeToggle() {
  const cameraMode = useViewer((state) => state.cameraMode)
  const setCameraMode = useViewer((state) => state.setCameraMode)

  return (
    <ToolbarTooltip label={cameraMode === 'perspective' ? 'Perspective' : 'Orthographic'}>
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

  return (
    <ToolbarTooltip label="Walkthrough">
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

function ImportDxfButton() {
  const [open, setOpen] = useState(false)

  return (
    <>
      <div className={TOOLBAR_CONTAINER}>
        <ToolbarTooltip label="导入 DXF">
          <button
            aria-label="导入 DXF"
            aria-pressed={open}
            className={cn(TOOLBAR_BTN, open && 'bg-white/10 text-foreground/90')}
            onClick={() => setOpen(true)}
            type="button"
          >
            <FileUp className="h-4 w-4" />
          </button>
        </ToolbarTooltip>
      </div>

      {open && (
        <div
          className="fixed inset-0 z-[300] flex items-start justify-center overflow-y-auto bg-black/50 pt-16 pb-8 backdrop-blur-sm"
          onClick={(e) => { if (e.target === e.currentTarget) setOpen(false) }}
        >
          <ImportDxfTool onClose={() => setOpen(false)} onDone={() => setOpen(false)} />
        </div>
      )}
    </>
  )
}

export function CommunityViewerToolbarLeft() {
  return (
    <>
      <CollapseSidebarButton />
      <ViewModeControl />
      <ImportDxfButton />
    </>
  )
}

export function CommunityViewerToolbarRight() {
  return (
    <div className={TOOLBAR_CONTAINER}>
      <LevelModeToggle />
      <WallModeToggle />
      <RenderModeMenu />
      <SceneThemeMenu />
      <EdgesMenu />
      <GridVisibilityToggle />
      <ShadowsToggle />
      <div className="my-1.5 w-px bg-border/50" />
      <UnitToggle />
      <CameraModeToggle />
      <div className="my-1.5 w-px bg-border/50" />
      <WalkthroughButton />
      <PreviewButton />
    </div>
  )
}

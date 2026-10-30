'use client'

import { Icon as IconifyIcon } from '@iconify/react'
import { type MessageDescriptor, usePascalI18n } from '@pascal-app/core'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
  type FloorplanWallDimensionFaces,
  sceneThemeName,
  useCeilingsSetting,
  useEditor,
  useFloorplanAnnotationVisibility,
  useFloorplanMode,
  useSidebarStore,
  useWallsBelowSetting,
  visibleScene,
} from '@pascal-app/editor'
import {
  CLAY_PALETTE,
  type EdgeMode,
  getSceneTheme,
  SCENE_THEMES,
  useViewer,
} from '@pascal-app/viewer'
import {
  ArrowDown,
  ArrowUp,
  Box,
  BrickWall,
  Check,
  ChevronsLeft,
  ChevronsRight,
  Contrast,
  Eye,
  EyeOff,
  Footprints,
  Grid2X2,
  Layers,
  Layers2,
  Layers3,
  Link2,
  Magnet,
  PenLine,
  Ruler,
  RulerDimensionLine,
  ScanLine,
  SlidersHorizontal,
  Sparkles,
  SquareUserRound,
  SwatchBook,
  Tag,
} from 'lucide-react'
import Image from 'next/image'
import { type ReactNode, useCallback } from 'react'
import { flushSync } from 'react-dom'
import { displayMenuLayout } from '@/lib/display-menu'
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

const levelModeOrder = ['stacked', 'exploded', 'solo'] as const
const levelModeLabels: Record<string, MessageDescriptor> = {
  manual: /* i18n */ { id: 'app.viewerToolbar.manual', message: 'Manual' },
  stacked: /* i18n */ { id: 'app.viewerToolbar.stack', message: 'Stack' },
  exploded: /* i18n */ { id: 'app.viewerToolbar.exploded', message: 'Exploded' },
  solo: /* i18n */ { id: 'app.viewerToolbar.solo', message: 'Solo' },
}

const wallModeOrder = ['cutaway', 'up', 'down', 'translucent'] as const
const wallModeConfig: Record<string, { icon: string; label: MessageDescriptor }> = {
  up: {
    icon: '/icons/room.webp',
    label: /* i18n */ { id: 'app.viewerToolbar.fullHeight', message: 'Full height' },
  },
  cutaway: {
    icon: '/icons/wallcut.webp',
    label: /* i18n */ { id: 'app.viewerToolbar.cutaway', message: 'Cutaway' },
  },
  down: {
    icon: '/icons/walllow.webp',
    label: /* i18n */ { id: 'app.viewerToolbar.low', message: 'Low' },
  },
  translucent: {
    icon: '/icons/wall.webp',
    label: /* i18n */ { id: 'app.viewerToolbar.translucent', message: 'Translucent' },
  },
}

const SHADING_OPTIONS = [
  {
    id: 'solid',
    name: /* i18n */ { id: 'app.viewerToolbar.solid', message: 'Solid' },
    detail: /* i18n */ {
      id: 'app.viewerToolbar.flatAndFastNoAmbientOcclusion',
      message: 'Flat and fast — no ambient occlusion',
    },
    icon: Box,
  },
  {
    id: 'rendered',
    name: /* i18n */ { id: 'app.viewerToolbar.rendered', message: 'Rendered' },
    detail: /* i18n */ {
      id: 'app.viewerToolbar.fullAmbientOcclusion',
      message: 'Full ambient occlusion',
    },
    icon: Sparkles,
  },
] as const

const FLOORPLAN_ANNOTATION_OPTIONS = [
  {
    id: 'automaticDimensions',
    name: /* i18n */ {
      id: 'app.viewerToolbar.automaticDimensions',
      message: 'Automatic dimensions',
    },
    icon: Ruler,
  },
  {
    id: 'manualDimensions',
    name: /* i18n */ { id: 'app.viewerToolbar.manualDimensions', message: 'Manual dimensions' },
    icon: Ruler,
  },
  {
    id: 'measurements',
    name: /* i18n */ { id: 'app.viewerToolbar.measurements', message: 'Measurements' },
    icon: ScanLine,
  },
  {
    id: 'openingMarks',
    name: /* i18n */ { id: 'app.viewerToolbar.doorWindowMarks', message: 'Door/window marks' },
    icon: Tag,
  },
  {
    id: 'structuralGrids',
    name: /* i18n */ {
      id: 'app.viewerToolbar.structuralGridsColumnCenters',
      message: 'Structural grids & column centers',
    },
    icon: Grid2X2,
  },
  {
    id: 'roomLabels',
    name: /* i18n */ { id: 'app.viewerToolbar.roomLabels', message: 'Room labels' },
    icon: SquareUserRound,
  },
  {
    id: 'stairAnnotations',
    name: /* i18n */ { id: 'app.viewerToolbar.stairAnnotations', message: 'Stair annotations' },
    icon: Footprints,
  },
] as const

const FLOORPLAN_MODE_OPTIONS = [
  {
    id: 'default',
    name: /* i18n */ { id: 'app.viewerToolbar.default', message: 'Default' },
    detail: /* i18n */ {
      id: 'app.viewerToolbar.cleanPlanDimensionsAppearWithSelection',
      message: 'Clean plan; dimensions appear with selection',
    },
  },
  {
    id: 'expert',
    name: /* i18n */ { id: 'app.viewerToolbar.expert', message: 'Expert' },
    detail: /* i18n */ {
      id: 'app.viewerToolbar.fullDocumentationAndAnnotationControls',
      message: 'Full documentation and annotation controls',
    },
  },
] as const

function CollapseSidebarButton() {
  const i18n = usePascalI18n()
  const isCollapsed = useSidebarStore((state) => state.isCollapsed)
  const setIsCollapsed = useSidebarStore((state) => state.setIsCollapsed)

  const toggle = useCallback(() => {
    setIsCollapsed(!isCollapsed)
  }, [isCollapsed, setIsCollapsed])

  return (
    <div className={TOOLBAR_CONTAINER}>
      <ToolbarTooltip
        label={
          isCollapsed
            ? i18n._({ id: 'app.viewerToolbar.expandSidebar', message: 'Expand sidebar' })
            : i18n._({ id: 'app.viewerToolbar.collapseSidebar', message: 'Collapse sidebar' })
        }
      >
        <button
          aria-label={
            isCollapsed
              ? i18n._({ id: 'app.viewerToolbar.expandSidebar', message: 'Expand sidebar' })
              : i18n._({ id: 'app.viewerToolbar.collapseSidebar', message: 'Collapse sidebar' })
          }
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
  const i18n = usePascalI18n()
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

  const modeLabel = i18n._(levelModeLabels[levelMode] ?? levelModeLabels.stacked!)
  const label = i18n._({
    id: 'app.viewerToolbar.levelsMode',
    message: 'Levels: {mode}',
    values: { mode: modeLabel },
  })

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
        <span className="font-medium text-xs">
          {levelMode === 'manual'
            ? i18n._({ id: 'app.viewerToolbar.stack', message: 'Stack' })
            : modeLabel}
        </span>
      </button>
    </ToolbarTooltip>
  )
}

function WallModeToggle() {
  const i18n = usePascalI18n()
  const wallMode = useViewer((state) => state.wallMode)
  const setWallMode = useViewer((state) => state.setWallMode)
  const config = wallModeConfig[wallMode] ?? wallModeConfig.cutaway!

  const cycle = () => {
    const index = wallModeOrder.indexOf(wallMode as (typeof wallModeOrder)[number])
    const next = wallModeOrder[(index + 1) % wallModeOrder.length]
    if (next) setWallMode(next)
  }

  return (
    <ToolbarTooltip
      label={i18n._({
        id: 'app.viewerToolbar.wallsLabel',
        message: 'Walls: {label}',
        values: { label: i18n._(config.label) },
      })}
    >
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
        <span className="font-medium text-xs">{i18n._(config.label)}</span>
      </button>
    </ToolbarTooltip>
  )
}

// One dropdown that gathers every "how the views look" control, grouped by what
// it changes: both views (Show, Dimensions, Editing), the plan, or the 3D scene.

const EDGE_OPTIONS = [
  {
    id: 'off',
    name: /* i18n */ { id: 'app.viewerToolbar.off', message: 'Off' },
    detail: /* i18n */ { id: 'app.viewerToolbar.noEdgeLines', message: 'No edge lines' },
  },
  {
    id: 'soft',
    name: /* i18n */ { id: 'app.viewerToolbar.soft', message: 'Soft' },
    detail: /* i18n */ {
      id: 'app.viewerToolbar.faintOutlineOfMajorCreases',
      message: 'Faint outline of major creases',
    },
  },
  {
    id: 'strong',
    name: /* i18n */ { id: 'app.viewerToolbar.strong', message: 'Strong' },
    detail: /* i18n */ {
      id: 'app.viewerToolbar.crispOpaqueEdgeLines',
      message: 'Crisp, opaque edge lines',
    },
  },
] as const satisfies readonly { id: EdgeMode; name: MessageDescriptor; detail: MessageDescriptor }[]

const SUBMENU_CONTENT_CLASS = 'min-w-56 rounded-xl border-border/45 bg-popover/95 backdrop-blur-xl'

/** Display → Measure walls: the faces wall dimensions measure to, with the line that explains each. */
const MEASURE_WALLS_OPTIONS = [
  {
    id: 'interior',
    name: /* i18n */ { id: 'app.viewerToolbar.inside', message: 'Inside' },
    tag: /* i18n */ {
      id: 'app.viewerToolbar.id',
      message: 'ID',
      comment: 'Short for inside dimension: measured between the inside faces of walls.',
    },
    detail: /* i18n */ {
      id: 'app.viewerToolbar.roomSizesInsideFaceToInsideFace',
      message: 'Room sizes, inside face to inside face',
    },
  },
  {
    id: 'exterior',
    name: /* i18n */ { id: 'app.viewerToolbar.outside', message: 'Outside' },
    tag: /* i18n */ {
      id: 'app.viewerToolbar.od',
      message: 'OD',
      comment: 'Short for outside dimension: measured between the outside faces of walls.',
    },
    detail: /* i18n */ {
      id: 'app.viewerToolbar.overallSizeOutsideFaceToOutsideFace',
      message: 'Overall size, outside face to outside face',
    },
  },
  {
    id: 'both',
    name: /* i18n */ { id: 'app.viewerToolbar.both', message: 'Both' },
    tag: /* i18n */ {
      id: 'app.viewerToolbar.idOd',
      message: 'ID + OD',
      comment: 'Inside and outside dimensions together.',
    },
    detail: /* i18n */ {
      id: 'app.viewerToolbar.roomSizesInsideOverallSizeOutside',
      message: 'Room sizes inside, overall size outside',
    },
  },
] as const satisfies readonly {
  id: FloorplanWallDimensionFaces
  name: MessageDescriptor
  tag: MessageDescriptor
  detail: MessageDescriptor
}[]

// Keep the menu open when flipping a toggle.
function keepOpen(event: Event, fn: () => void) {
  event.preventDefault()
  fn()
}

/** One titled group of the Display menu; `tag` names the only view it changes. */
function DisplayGroup({
  label,
  tag,
  children,
}: {
  label: string
  tag?: string
  children: ReactNode
}) {
  return (
    <DropdownMenuGroup>
      <DropdownMenuLabel className="flex items-center gap-2 px-2 pt-2 pb-1 font-semibold text-[10px] text-muted-foreground uppercase tracking-wider">
        <span>{label}</span>
        {tag ? (
          <span className="ml-auto rounded border border-border/60 px-1 font-medium text-[10px] normal-case tracking-normal">
            {tag}
          </span>
        ) : null}
      </DropdownMenuLabel>
      {children}
    </DropdownMenuGroup>
  )
}

function ShownIcon({ shown }: { shown: boolean }) {
  return shown ? (
    <Eye className="ml-auto h-4 w-4 text-foreground" />
  ) : (
    <EyeOff className="ml-auto h-4 w-4 text-muted-foreground" />
  )
}

function DisplayMenu() {
  const i18n = usePascalI18n()
  const layout = displayMenuLayout(useEditor(visibleScene))
  const levelId = useViewer((state) => state.selection.levelId)
  const { shown: showCeilings, setShown: setShowCeilings } = useCeilingsSetting(levelId)
  // The dashed walls of the levels below and above, on the plan.
  const { shown: showWallsBelow, setShown: setShowWallsBelow } = useWallsBelowSetting(levelId)
  const showWallsAbove = useEditor((state) => state.showWallsAbove)
  const setShowWallsAbove = useEditor((state) => state.setShowWallsAbove)
  const showGrid = useViewer((state) => state.showGrid)
  const setShowGrid = useViewer((state) => state.setShowGrid)
  const showMeasurements = useViewer((state) => state.showMeasurements)
  const setShowMeasurements = useViewer((state) => state.setShowMeasurements)
  const unit = useViewer((state) => state.unit)
  const setUnit = useViewer((state) => state.setUnit)
  const metricNotation = useViewer((state) => state.metricNotation)
  const setMetricNotation = useViewer((state) => state.setMetricNotation)
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
  const annotationVisibility = useFloorplanAnnotationVisibility((state) => state.visibility)
  const setAnnotationCategory = useFloorplanAnnotationVisibility((state) => state.setCategory)
  const showDimensions = useFloorplanAnnotationVisibility((state) => state.showDimensions)
  const setShowDimensions = useFloorplanAnnotationVisibility((state) => state.setShowDimensions)
  const wallDimensionFaces = useFloorplanAnnotationVisibility((state) => state.wallDimensionFaces)
  const setWallDimensionFaces = useFloorplanAnnotationVisibility(
    (state) => state.setWallDimensionFaces,
  )
  const floorplanMode = useFloorplanMode((state) => state.mode)
  const setFloorplanMode = useFloorplanMode((state) => state.setMode)

  const activeShading =
    SHADING_OPTIONS.find((option) => option.id === shading) ?? SHADING_OPTIONS[0]
  const activeEdges = EDGE_OPTIONS.find((option) => option.id === edges) ?? EDGE_OPTIONS[0]
  const activeTheme = getSceneTheme(sceneTheme)
  const activeMeasureWalls =
    MEASURE_WALLS_OPTIONS.find((option) => option.id === wallDimensionFaces) ??
    MEASURE_WALLS_OPTIONS[2]
  const onLabel = i18n._({ id: 'app.viewerToolbar.on', message: 'On' })
  const offLabel = i18n._({ id: 'app.viewerToolbar.off', message: 'Off' })
  const planOnly = i18n._({ id: 'app.viewerToolbar.n2dOnly', message: '2D only' })
  const sceneOnly = i18n._({ id: 'app.viewerToolbar.n3dOnly', message: '3D only' })
  const otherLevelChips = [
    {
      id: 'below',
      shown: showWallsBelow,
      toggle: () => setShowWallsBelow(!showWallsBelow),
      icon: ArrowDown,
      name: i18n._({ id: 'app.viewerToolbar.below', message: 'Below' }),
      label: i18n._({ id: 'editor.actionMenu.viewToggles.wallsBelow', message: 'Walls below' }),
    },
    {
      id: 'above',
      shown: showWallsAbove,
      toggle: () => setShowWallsAbove(!showWallsAbove),
      icon: ArrowUp,
      name: i18n._({ id: 'app.viewerToolbar.above', message: 'Above' }),
      label: i18n._({ id: 'editor.actionMenu.viewToggles.wallsAbove', message: 'Walls above' }),
    },
  ]

  return (
    <DropdownMenu>
      <ToolbarTooltip
        label={i18n._({ id: 'app.viewerToolbar.displaySettings', message: 'Display settings' })}
      >
        <DropdownMenuTrigger asChild>
          <button
            aria-label={i18n._({
              id: 'app.viewerToolbar.displaySettings',
              message: 'Display settings',
            })}
            className={cn(TOOLBAR_BTN, 'w-auto gap-1.5 px-2.5 text-foreground/90')}
            type="button"
          >
            <SlidersHorizontal className="h-3.5 w-3.5 shrink-0" />
            <span className="font-medium text-xs">
              {i18n._({ id: 'app.viewerToolbar.display', message: 'Display' })}
            </span>
          </button>
        </DropdownMenuTrigger>
      </ToolbarTooltip>
      <DropdownMenuContent
        align="end"
        className="w-80 rounded-xl border-border/45 bg-popover/95 backdrop-blur-xl"
        side="bottom"
        sideOffset={8}
      >
        <div className="px-2 pt-1.5 pb-1">
          <p className="font-medium text-foreground text-sm">
            {i18n._({ id: 'app.viewerToolbar.display', message: 'Display' })}
          </p>
          <p className="flex items-center gap-1 text-muted-foreground text-xs">
            <Link2 className="h-3 w-3 shrink-0" />
            {layout.scope === 'shared'
              ? i18n._({ id: 'app.viewerToolbar.sharedBy2dAnd3d', message: 'Shared by 2D and 3D' })
              : layout.scope === '2d'
                ? planOnly
                : sceneOnly}
          </p>
        </div>

        <DropdownMenuSeparator />
        <DisplayGroup label={i18n._({ id: 'app.viewerToolbar.show', message: 'Show' })}>
          <DropdownMenuItem onSelect={(e) => keepOpen(e, () => setShowGrid(!showGrid))}>
            <Grid2X2 className="h-4 w-4" />
            <span>{i18n._({ id: 'app.viewerToolbar.grid', message: 'Grid' })}</span>
            <ShownIcon shown={showGrid} />
          </DropdownMenuItem>
          {layout.otherLevels ? (
            <div className="flex items-center gap-2 px-2 py-1.5">
              <Layers className="h-4 w-4 shrink-0 text-muted-foreground" />
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="text-sm">
                  {i18n._({ id: 'app.viewerToolbar.otherLevels', message: 'Other levels' })}
                </span>
                <span className="text-muted-foreground text-xs">
                  {i18n._({
                    id: 'app.viewerToolbar.ghostedForReference',
                    message: 'Ghosted for reference',
                  })}
                </span>
              </div>
              {otherLevelChips.map((chip) => (
                <DropdownMenuItem
                  aria-checked={chip.shown}
                  aria-label={chip.label}
                  className={cn(
                    'gap-1 rounded-md border px-1.5 py-0.5 text-xs',
                    chip.shown
                      ? 'border-border bg-accent text-foreground [&_svg]:text-foreground'
                      : 'border-border/50 text-muted-foreground',
                  )}
                  key={chip.id}
                  onSelect={(e) => keepOpen(e, chip.toggle)}
                  role="menuitemcheckbox"
                >
                  <chip.icon className="size-3" />
                  {chip.name}
                </DropdownMenuItem>
              ))}
            </div>
          ) : null}
        </DisplayGroup>

        <DropdownMenuSeparator />
        <DisplayGroup label={i18n._({ id: 'app.viewerToolbar.dimensions', message: 'Dimensions' })}>
          <DropdownMenuItem onSelect={(e) => keepOpen(e, () => setShowDimensions(!showDimensions))}>
            <RulerDimensionLine className="h-4 w-4" />
            <span>{i18n._({ id: 'app.viewerToolbar.dimensions', message: 'Dimensions' })}</span>
            <ShownIcon shown={showDimensions} />
          </DropdownMenuItem>
          <div className="px-2 py-1.5">
            <div className="flex items-center gap-2 pb-1.5 text-sm" id="display-measure-walls">
              <BrickWall className="h-4 w-4 shrink-0 text-muted-foreground" />
              {i18n._({ id: 'app.viewerToolbar.measureWalls', message: 'Measure walls' })}
            </div>
            <div
              aria-labelledby="display-measure-walls"
              className="grid grid-cols-3 gap-0.5 rounded-lg border border-border/50 bg-muted/40 p-0.5"
              role="group"
            >
              {MEASURE_WALLS_OPTIONS.map((option) => {
                const checked = wallDimensionFaces === option.id
                return (
                  <DropdownMenuItem
                    aria-checked={checked}
                    className={cn(
                      'flex-col items-center justify-center gap-0 rounded-md px-1 py-1 text-xs',
                      checked
                        ? 'bg-accent text-foreground shadow-sm ring-1 ring-border'
                        : 'text-muted-foreground',
                    )}
                    disabled={!showDimensions}
                    key={option.id}
                    onSelect={(e) => keepOpen(e, () => setWallDimensionFaces(option.id))}
                    role="menuitemradio"
                  >
                    <span className="font-medium">{i18n._(option.name)}</span>
                    <span
                      className={cn(
                        'font-mono text-[10px]',
                        checked ? 'text-primary' : 'text-muted-foreground',
                      )}
                    >
                      {i18n._(option.tag)}
                    </span>
                  </DropdownMenuItem>
                )
              })}
            </div>
            <p className="pt-1.5 text-muted-foreground text-xs">
              {showDimensions
                ? i18n._(activeMeasureWalls.detail)
                : i18n._({
                    id: 'app.viewerToolbar.turnOnDimensionsToShowThem',
                    message: 'Turn on Dimensions to show them',
                  })}
            </p>
          </div>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <Ruler className="h-4 w-4" />
              <span>{i18n._({ id: 'app.viewerToolbar.units', message: 'Units' })}</span>
              <span className="ml-auto text-muted-foreground text-xs">
                {unit === 'imperial'
                  ? i18n._({ id: 'app.viewerToolbar.feetInches', message: 'Feet & inches' })
                  : metricNotation === 'millimeters'
                    ? i18n._({ id: 'app.viewerToolbar.millimeters', message: 'Millimeters' })
                    : i18n._({ id: 'app.viewerToolbar.meters', message: 'Meters' })}
              </span>
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className={SUBMENU_CONTENT_CLASS}>
              <DropdownMenuItem onSelect={() => setMetricNotation('meters')}>
                <span className="flex h-4 w-4 items-center justify-center font-semibold text-[10px]">
                  m
                </span>
                <span>{i18n._({ id: 'app.viewerToolbar.meters', message: 'Meters' })}</span>
                {unit === 'metric' && metricNotation === 'meters' ? (
                  <Check className="ml-auto h-4 w-4 text-foreground" />
                ) : null}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setMetricNotation('millimeters')}>
                <span className="flex h-4 w-4 items-center justify-center font-semibold text-[10px]">
                  mm
                </span>
                <span>
                  {i18n._({ id: 'app.viewerToolbar.millimeters', message: 'Millimeters' })}
                </span>
                {unit === 'metric' && metricNotation === 'millimeters' ? (
                  <Check className="ml-auto h-4 w-4 text-foreground" />
                ) : null}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setUnit('imperial')}>
                <span className="flex h-4 w-4 items-center justify-center font-semibold text-[10px]">
                  ft
                </span>
                <span>
                  {i18n._({ id: 'app.viewerToolbar.feetInches', message: 'Feet & inches' })}
                </span>
                {unit === 'imperial' ? <Check className="ml-auto h-4 w-4 text-foreground" /> : null}
              </DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        </DisplayGroup>

        {layout.plan ? (
          <>
            <DropdownMenuSeparator />
            <DisplayGroup
              label={i18n._({ id: 'app.viewerToolbar.plan', message: 'Plan' })}
              tag={layout.viewTags ? planOnly : undefined}
            >
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  <Layers3 className="h-4 w-4" />
                  <span>
                    {i18n._({ id: 'app.viewerToolbar.floorPlanMode', message: 'Floor plan mode' })}
                  </span>
                  <span className="ml-auto text-muted-foreground text-xs">
                    {floorplanMode === 'default'
                      ? i18n._({ id: 'app.viewerToolbar.default', message: 'Default' })
                      : i18n._({ id: 'app.viewerToolbar.expert', message: 'Expert' })}
                  </span>
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent className={SUBMENU_CONTENT_CLASS}>
                  {FLOORPLAN_MODE_OPTIONS.map((option) => (
                    <DropdownMenuItem key={option.id} onSelect={() => setFloorplanMode(option.id)}>
                      <div className="flex flex-col">
                        <span className="text-foreground">{i18n._(option.name)}</span>
                        <span className="text-muted-foreground text-xs">
                          {i18n._(option.detail)}
                        </span>
                      </div>
                      {floorplanMode === option.id ? (
                        <Check className="ml-auto h-4 w-4 text-foreground" />
                      ) : null}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuSubContent>
              </DropdownMenuSub>
              {/* Default draws a fixed clean set: the categories only apply in Expert. */}
              {floorplanMode === 'expert' ? (
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger>
                    <Tag className="h-4 w-4" />
                    <span>
                      {i18n._({
                        id: 'app.viewerToolbar.floorPlanAnnotations',
                        message: 'Floor plan annotations',
                      })}
                    </span>
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent className={SUBMENU_CONTENT_CLASS}>
                    {FLOORPLAN_ANNOTATION_OPTIONS.map((option) => {
                      const OptionIcon = option.icon
                      const visible = annotationVisibility[option.id]
                      return (
                        <DropdownMenuItem
                          key={option.id}
                          onSelect={(e) =>
                            keepOpen(e, () => setAnnotationCategory(option.id, !visible))
                          }
                        >
                          <OptionIcon className="h-4 w-4" />
                          <span>{i18n._(option.name)}</span>
                          <ShownIcon shown={visible} />
                        </DropdownMenuItem>
                      )
                    })}
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
              ) : null}
            </DisplayGroup>
          </>
        ) : null}

        {layout.scene ? (
          <>
            <DropdownMenuSeparator />
            <DisplayGroup
              label={i18n._({ id: 'app.viewerToolbar.scene', message: 'Scene' })}
              tag={layout.viewTags ? sceneOnly : undefined}
            >
              <DropdownMenuItem onSelect={(e) => keepOpen(e, () => setShowCeilings(!showCeilings))}>
                <Layers2 className="h-4 w-4" />
                <span>{i18n._({ id: 'app.viewerToolbar.ceilings', message: 'Ceilings' })}</span>
                <ShownIcon shown={showCeilings} />
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={(e) => keepOpen(e, () => setShowMeasurements(!showMeasurements))}
              >
                <ScanLine className="h-4 w-4" />
                <span>
                  {i18n._({ id: 'app.viewerToolbar.measurements', message: 'Measurements' })}
                </span>
                <ShownIcon shown={showMeasurements} />
              </DropdownMenuItem>
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  <activeShading.icon className="h-4 w-4" />
                  <span>{i18n._({ id: 'app.viewerToolbar.render', message: 'Render' })}</span>
                  <span className="ml-auto text-muted-foreground text-xs">
                    {i18n._(activeShading.name)}
                  </span>
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent className={SUBMENU_CONTENT_CLASS}>
                  {SHADING_OPTIONS.map((option) => {
                    const OptionIcon = option.icon
                    return (
                      <DropdownMenuItem key={option.id} onSelect={() => setShading(option.id)}>
                        <OptionIcon className="h-4 w-4" />
                        <div className="flex flex-col">
                          <span className="text-foreground">{i18n._(option.name)}</span>
                          <span className="text-muted-foreground text-xs">
                            {i18n._(option.detail)}
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
                  <span>{i18n._({ id: 'app.viewerToolbar.edges', message: 'Edges' })}</span>
                  <span className="ml-auto text-muted-foreground text-xs">
                    {i18n._(activeEdges.name)}
                  </span>
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent className={SUBMENU_CONTENT_CLASS}>
                  {EDGE_OPTIONS.map((option) => (
                    <DropdownMenuItem key={option.id} onSelect={() => setEdges(option.id)}>
                      <div className="flex flex-col">
                        <span className="text-foreground">{i18n._(option.name)}</span>
                        <span className="text-muted-foreground text-xs">
                          {i18n._(option.detail)}
                        </span>
                      </div>
                      {edges === option.id ? (
                        <Check className="ml-auto h-4 w-4 text-foreground" />
                      ) : null}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuSubContent>
              </DropdownMenuSub>
              <DropdownMenuItem onSelect={(e) => keepOpen(e, () => setShadows(!shadows))}>
                <Contrast className="h-4 w-4" />
                <span>{i18n._({ id: 'app.viewerToolbar.shadows', message: 'Shadows' })}</span>
                <span className="ml-auto text-muted-foreground text-xs">
                  {shadows ? onLabel : offLabel}
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
                  icon={
                    cameraMode === 'perspective' ? 'icon-park-outline:perspective' : 'vaadin:grid'
                  }
                  width={16}
                />
                <span>{i18n._({ id: 'app.viewerToolbar.camera', message: 'Camera' })}</span>
                <span className="ml-auto text-muted-foreground text-xs">
                  {cameraMode === 'perspective'
                    ? i18n._({ id: 'app.viewerToolbar.perspective', message: 'Perspective' })
                    : i18n._({ id: 'app.viewerToolbar.orthographic', message: 'Orthographic' })}
                </span>
              </DropdownMenuItem>
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  <SwatchBook className="h-4 w-4" />
                  <span>
                    {i18n._({ id: 'app.viewerToolbar.sceneTheme', message: 'Scene theme' })}
                  </span>
                  <span className="ml-auto truncate text-muted-foreground text-xs">
                    {sceneThemeName(activeTheme.id, activeTheme.name, i18n)}
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
                        <span className="text-foreground">
                          {sceneThemeName(theme.id, theme.name, i18n)}
                        </span>
                        {sceneTheme === theme.id ? (
                          <Check className="ml-auto h-4 w-4 text-foreground" />
                        ) : null}
                      </DropdownMenuItem>
                    )
                  })}
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            </DisplayGroup>
          </>
        ) : null}

        <DropdownMenuSeparator />
        <DisplayGroup label={i18n._({ id: 'app.viewerToolbar.editing', message: 'Editing' })}>
          <DropdownMenuItem onSelect={(e) => keepOpen(e, () => setMagneticSnap(!magneticSnap))}>
            <Magnet className="h-4 w-4" />
            <span>
              {i18n._({ id: 'app.viewerToolbar.magneticSnap', message: 'Magnetic snap' })}
            </span>
            <span className="ml-auto text-muted-foreground text-xs">
              {magneticSnap ? onLabel : offLabel}
            </span>
          </DropdownMenuItem>
        </DisplayGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function WalkthroughButton() {
  const i18n = usePascalI18n()
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
    <ToolbarTooltip label={i18n._({ id: 'app.viewerToolbar.walkthrough', message: 'Walkthrough' })}>
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
  const i18n = usePascalI18n()
  return (
    <ToolbarTooltip
      label={i18n._({ id: 'app.viewerToolbar.previewMode', message: 'Preview mode' })}
    >
      <button
        className="flex items-center gap-1.5 px-2.5 font-medium text-muted-foreground/80 text-xs transition-colors hover:bg-white/8 hover:text-foreground/90"
        onClick={() => useEditor.getState().setPreviewMode(true)}
        type="button"
      >
        <Eye className="h-3.5 w-3.5 shrink-0" />
        <span>{i18n._({ id: 'app.viewerToolbar.preview', message: 'Preview' })}</span>
      </button>
    </ToolbarTooltip>
  )
}

function VRButton({
  active,
  disabled,
  label,
  onToggle,
}: {
  active: boolean
  disabled: boolean
  label: string
  onToggle: () => void
}) {
  return (
    <ToolbarTooltip label={label}>
      <button
        aria-label={label}
        aria-pressed={active}
        className={cn(TOOLBAR_BTN, active && 'bg-sky-500/15 text-sky-400 hover:bg-sky-500/20')}
        disabled={disabled}
        onClick={onToggle}
        type="button"
      >
        <IconifyIcon
          className={cn('h-4 w-4', disabled && 'animate-pulse opacity-45')}
          icon="mdi:virtual-reality"
        />
      </button>
    </ToolbarTooltip>
  )
}

export function EditorViewerToolbarLeft() {
  return (
    <>
      <CollapseSidebarButton />
    </>
  )
}

export function EditorViewerToolbarRight({
  onVRToggle,
  vrButton,
  vrActive = false,
  vrDisabled = false,
  vrLabel,
}: {
  onVRToggle?: () => void
  vrButton?: ReactNode
  vrActive?: boolean
  vrDisabled?: boolean
  vrLabel?: string
}) {
  const i18n = usePascalI18n()
  const label =
    vrLabel ??
    (vrActive
      ? i18n._({ id: 'app.viewerToolbar.exitVr', message: 'Exit VR' })
      : i18n._({ id: 'app.viewerToolbar.enterVr', message: 'Enter VR' }))
  return (
    <div className={TOOLBAR_CONTAINER}>
      <LevelModeToggle />
      <WallModeToggle />
      <div className="my-1.5 w-px bg-border/50" />
      <DisplayMenu />
      <div className="my-1.5 w-px bg-border/50" />
      <WalkthroughButton />
      {onVRToggle || vrButton
        ? (vrButton ??
          (onVRToggle ? (
            <VRButton active={vrActive} disabled={vrDisabled} label={label} onToggle={onVRToggle} />
          ) : null))
        : null}
      <PreviewButton />
    </div>
  )
}

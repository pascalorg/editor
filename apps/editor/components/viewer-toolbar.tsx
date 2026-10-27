'use client'

import { Icon as IconifyIcon } from '@iconify/react'
import { type MessageDescriptor, usePascalI18n } from '@pascal-app/core'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
  sceneThemeName,
  useEditor,
  useFloorplanAnnotationVisibility,
  useFloorplanMode,
  useSidebarStore,
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
  Box,
  Check,
  ChevronsLeft,
  ChevronsRight,
  Contrast,
  Eye,
  EyeOff,
  Footprints,
  Grid2X2,
  Layers3,
  Magnet,
  PenLine,
  Ruler,
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

const FLOORPLAN_WALL_DIMENSION_REFERENCE_OPTIONS = [
  {
    id: 'finished-faces',
    name: /* i18n */ { id: 'app.viewerToolbar.finishedFaces', message: 'Finished faces' },
    detail: /* i18n */ {
      id: 'app.viewerToolbar.fullWallThickness',
      message: 'Full wall thickness',
    },
  },
  {
    id: 'centerline',
    name: /* i18n */ { id: 'app.viewerToolbar.wallCenterline', message: 'Wall centerline' },
    detail: /* i18n */ { id: 'app.viewerToolbar.singleWallAxis', message: 'Single wall axis' },
  },
  {
    id: 'stud-faces',
    name: /* i18n */ { id: 'app.viewerToolbar.faceOfStud', message: 'Face of stud' },
    detail: /* i18n */ {
      id: 'app.viewerToolbar.structuralCoreFace',
      message: 'Structural core face',
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

// One dropdown that gathers every "how the scene looks" control: grid, shadows,
// camera projection, units, render mode, edges and scene theme.

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

function DisplayMenu() {
  const i18n = usePascalI18n()
  const scene = useEditor(visibleScene)
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
  const wallDimensionReference = useFloorplanAnnotationVisibility(
    (state) => state.wallDimensionReference,
  )
  const setWallDimensionReference = useFloorplanAnnotationVisibility(
    (state) => state.setWallDimensionReference,
  )
  const floorplanMode = useFloorplanMode((state) => state.mode)
  const setFloorplanMode = useFloorplanMode((state) => state.setMode)

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
        className="w-max min-w-60 max-w-80 rounded-xl border-border/45 bg-popover/95 backdrop-blur-xl"
        side="bottom"
        sideOffset={8}
      >
        <DropdownMenuItem onSelect={(e) => keepOpen(e, () => setShowGrid(!showGrid))}>
          <Grid2X2 className="h-4 w-4" />
          <span>{i18n._({ id: 'app.viewerToolbar.grid', message: 'Grid' })}</span>
          {showGrid ? (
            <Eye className="ml-auto h-4 w-4 text-foreground" />
          ) : (
            <EyeOff className="ml-auto h-4 w-4 text-muted-foreground" />
          )}
        </DropdownMenuItem>
        {scene === '3d' || scene === 'split' ? (
          <DropdownMenuItem
            onSelect={(e) => keepOpen(e, () => setShowMeasurements(!showMeasurements))}
          >
            <Ruler className="h-4 w-4" />
            <span>
              {scene === 'split'
                ? i18n._({ id: 'app.viewerToolbar.n3dMeasurements', message: '3D measurements' })
                : i18n._({ id: 'app.viewerToolbar.measurements', message: 'Measurements' })}
            </span>
            {showMeasurements ? (
              <Eye className="ml-auto h-4 w-4 text-foreground" />
            ) : (
              <EyeOff className="ml-auto h-4 w-4 text-muted-foreground" />
            )}
          </DropdownMenuItem>
        ) : null}
        {scene === '2d' || scene === 'split' ? (
          <>
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
                      <span className="text-muted-foreground text-xs">{i18n._(option.detail)}</span>
                    </div>
                    {floorplanMode === option.id ? (
                      <Check className="ml-auto h-4 w-4 text-foreground" />
                    ) : null}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            {floorplanMode === 'expert' ? (
              <>
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger>
                    <Layers3 className="h-4 w-4" />
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
                          {visible ? (
                            <Eye className="ml-auto h-4 w-4 text-foreground" />
                          ) : (
                            <EyeOff className="ml-auto h-4 w-4 text-muted-foreground" />
                          )}
                        </DropdownMenuItem>
                      )
                    })}
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger>
                    <Ruler className="h-4 w-4" />
                    <span>
                      {i18n._({
                        id: 'app.viewerToolbar.wallDimensions',
                        message: 'Wall dimensions',
                      })}
                    </span>
                    <span className="ml-auto text-muted-foreground text-xs">
                      {i18n._(
                        (
                          FLOORPLAN_WALL_DIMENSION_REFERENCE_OPTIONS.find(
                            (option) => option.id === wallDimensionReference,
                          ) ?? FLOORPLAN_WALL_DIMENSION_REFERENCE_OPTIONS[0]
                        ).name,
                      )}
                    </span>
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent className={SUBMENU_CONTENT_CLASS}>
                    {FLOORPLAN_WALL_DIMENSION_REFERENCE_OPTIONS.map((option) => (
                      <DropdownMenuItem
                        key={option.id}
                        onSelect={(event) =>
                          keepOpen(event, () => setWallDimensionReference(option.id))
                        }
                      >
                        <div className="flex flex-col">
                          <span className="text-foreground">{i18n._(option.name)}</span>
                          <span className="text-muted-foreground text-xs">
                            {i18n._(option.detail)}
                          </span>
                        </div>
                        {wallDimensionReference === option.id ? (
                          <Check className="ml-auto h-4 w-4 text-foreground" />
                        ) : null}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
              </>
            ) : null}
          </>
        ) : null}
        <DropdownMenuItem onSelect={(e) => keepOpen(e, () => setMagneticSnap(!magneticSnap))}>
          <Magnet className="h-4 w-4" />
          <span>{i18n._({ id: 'app.viewerToolbar.magneticSnap', message: 'Magnetic snap' })}</span>
          <span className="ml-auto text-muted-foreground text-xs">
            {magneticSnap
              ? i18n._({ id: 'app.viewerToolbar.on', message: 'On' })
              : i18n._({ id: 'app.viewerToolbar.off', message: 'Off' })}
          </span>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={(e) => keepOpen(e, () => setShadows(!shadows))}>
          <Contrast className="h-4 w-4" />
          <span>{i18n._({ id: 'app.viewerToolbar.shadows', message: 'Shadows' })}</span>
          <span className="ml-auto text-muted-foreground text-xs">
            {shadows
              ? i18n._({ id: 'app.viewerToolbar.on', message: 'On' })
              : i18n._({ id: 'app.viewerToolbar.off', message: 'Off' })}
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
          <span>{i18n._({ id: 'app.viewerToolbar.camera', message: 'Camera' })}</span>
          <span className="ml-auto text-muted-foreground text-xs">
            {cameraMode === 'perspective'
              ? i18n._({ id: 'app.viewerToolbar.perspective', message: 'Perspective' })
              : i18n._({ id: 'app.viewerToolbar.orthographic', message: 'Orthographic' })}
          </span>
        </DropdownMenuItem>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <span className="flex h-4 w-4 items-center justify-center font-semibold text-[10px]">
              {unit === 'imperial' ? 'ft' : metricNotation === 'millimeters' ? 'mm' : 'm'}
            </span>
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
              <span>{i18n._({ id: 'app.viewerToolbar.millimeters', message: 'Millimeters' })}</span>
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

        <DropdownMenuSeparator />

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
                    <span className="text-muted-foreground text-xs">{i18n._(option.detail)}</span>
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
                  <span className="text-muted-foreground text-xs">{i18n._(option.detail)}</span>
                </div>
                {edges === option.id ? <Check className="ml-auto h-4 w-4 text-foreground" /> : null}
              </DropdownMenuItem>
            ))}
          </DropdownMenuSubContent>
        </DropdownMenuSub>

        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <SwatchBook className="h-4 w-4" />
            <span>{i18n._({ id: 'app.viewerToolbar.sceneTheme', message: 'Scene theme' })}</span>
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

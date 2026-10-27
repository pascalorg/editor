'use client'

import { emitter, type PascalI18n, usePascalI18n } from '@pascal-app/core'
import {
  CLAY_PALETTE,
  type EdgeMode,
  getSceneTheme,
  SCENE_THEMES,
  useViewer,
} from '@pascal-app/viewer'
import {
  Box,
  Camera,
  Check,
  Contrast,
  Diamond,
  Eye,
  EyeOff,
  Footprints,
  Layers,
  Layers2,
  Palette,
  PenLine,
  SlidersHorizontal,
  Sparkles,
  Square,
  SwatchBook,
} from 'lucide-react'
import { sceneThemeName } from '../../i18n/scene-theme-name'
import { cn } from '../../lib/utils'
import { ActionButton } from '../ui/action-menu/action-button'
import { FollowPascalToggle } from '../ui/action-menu/follow-pascal-toggle'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '../ui/primitives/dropdown-menu'
import { TooltipProvider } from '../ui/primitives/tooltip'

const wallModeConfig = {
  up: {
    icon: '/icons/room.webp',
  },
  cutaway: {
    icon: '/icons/wallcut.webp',
  },
  down: {
    icon: '/icons/walllow.webp',
  },
} as const

function levelModeLabel(
  mode: 'stacked' | 'exploded' | 'solo' | 'manual',
  i18n: PascalI18n,
): string {
  if (mode === 'stacked') return i18n._({ id: 'viewer.levels.stacked', message: 'Stacked' })
  if (mode === 'exploded') return i18n._({ id: 'viewer.levels.exploded', message: 'Exploded' })
  if (mode === 'solo') return i18n._({ id: 'viewer.levels.solo', message: 'Solo' })
  return i18n._({ id: 'viewer.levels.manual', message: 'Manual' })
}

function wallModeLabel(mode: keyof typeof wallModeConfig, i18n: PascalI18n): string {
  if (mode === 'up') return i18n._({ id: 'viewer.walls.fullHeight', message: 'Full height' })
  if (mode === 'down') return i18n._({ id: 'viewer.walls.low', message: 'Low' })
  return i18n._({ id: 'viewer.walls.cutaway', message: 'Cutaway' })
}

// Keep the dropdown open when flipping an in-place toggle row.
const keepOpen = (event: Event, fn: () => void) => {
  event.preventDefault()
  fn()
}

// Scans + guides folded into one control. A baked GLB carries none of its own,
// but the GLB viewer re-adds them from scene data when the privacy flags allow,
// so the toggle shows for whichever exist.
function VisibilityMenu({
  canShowScans,
  canShowGuides,
}: {
  canShowScans: boolean
  canShowGuides: boolean
}) {
  const i18n = usePascalI18n()
  const showScans = useViewer((s) => s.showScans)
  const showGuides = useViewer((s) => s.showGuides)
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <ActionButton
          className="hover:bg-white/5 hover:text-foreground"
          label={i18n._({ id: 'viewer.visibility.title', message: 'Visibility' })}
          size="icon"
          tooltipClassName="dark"
          tooltipSide="top"
          variant="ghost"
        >
          <Eye className="h-5 w-5" />
        </ActionButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="center" className="dark min-w-44" side="top">
        {canShowScans && (
          <DropdownMenuItem
            onSelect={(e) => keepOpen(e, () => useViewer.getState().setShowScans(!showScans))}
          >
            <img alt="" className="h-4 w-4 object-contain" src="/icons/mesh.webp" />
            <span>{i18n._({ id: 'viewer.visibility.scans', message: 'Scans' })}</span>
            {showScans ? (
              <Eye className="ml-auto h-4 w-4 text-foreground" />
            ) : (
              <EyeOff className="ml-auto h-4 w-4 text-muted-foreground" />
            )}
          </DropdownMenuItem>
        )}
        {canShowGuides && (
          <DropdownMenuItem
            onSelect={(e) => keepOpen(e, () => useViewer.getState().setShowGuides(!showGuides))}
          >
            <img alt="" className="h-4 w-4 object-contain" src="/icons/floorplan.webp" />
            <span>{i18n._({ id: 'viewer.visibility.guides', message: 'Guides' })}</span>
            {showGuides ? (
              <Eye className="ml-auto h-4 w-4 text-foreground" />
            ) : (
              <EyeOff className="ml-auto h-4 w-4 text-muted-foreground" />
            )}
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

// One "Display" button gathering shadows, camera projection, colors, render
// mode, scene theme and edges.
function DisplayMenu() {
  const i18n = usePascalI18n()
  const cameraMode = useViewer((s) => s.cameraMode)
  const shading = useViewer((s) => s.shading)
  const textures = useViewer((s) => s.textures)
  const shadows = useViewer((s) => s.shadows)
  const sceneTheme = useViewer((s) => s.sceneTheme)
  const edges = useViewer((s) => s.edges)
  const shadingOptions = [
    {
      id: 'solid',
      name: i18n._({ id: 'viewer.display.render.solid', message: 'Solid' }),
      detail: i18n._({
        id: 'viewer.display.render.solidDetail',
        message: 'Flat and fast — no ambient occlusion',
      }),
      icon: Box,
    },
    {
      id: 'rendered',
      name: i18n._({ id: 'viewer.display.render.rendered', message: 'Rendered' }),
      detail: i18n._({
        id: 'viewer.display.render.renderedDetail',
        message: 'Full ambient occlusion',
      }),
      icon: Sparkles,
    },
  ] as const
  const edgeOptions = [
    {
      id: 'off',
      name: i18n._({ id: 'viewer.display.edges.off', message: 'Off' }),
      detail: i18n._({ id: 'viewer.display.edges.offDetail', message: 'No edge lines' }),
    },
    {
      id: 'soft',
      name: i18n._({ id: 'viewer.display.edges.soft', message: 'Soft' }),
      detail: i18n._({
        id: 'viewer.display.edges.softDetail',
        message: 'Faint outline of major creases',
      }),
    },
    {
      id: 'strong',
      name: i18n._({ id: 'viewer.display.edges.strong', message: 'Strong' }),
      detail: i18n._({
        id: 'viewer.display.edges.strongDetail',
        message: 'Crisp, opaque edge lines',
      }),
    },
  ] as const satisfies readonly { id: EdgeMode; name: string; detail: string }[]
  const activeShading = shadingOptions.find((o) => o.id === shading) ?? shadingOptions[0]
  const activeTheme = getSceneTheme(sceneTheme)
  const activeEdges = edgeOptions.find((o) => o.id === edges) ?? edgeOptions[0]
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <ActionButton
          className="hover:bg-white/5 hover:text-foreground"
          label={i18n._({ id: 'viewer.display.title', message: 'Display settings' })}
          size="icon"
          tooltipClassName="dark"
          tooltipSide="top"
          variant="ghost"
        >
          <SlidersHorizontal className="h-5 w-5" />
        </ActionButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="center" className="dark min-w-56" side="top">
        <DropdownMenuItem
          onSelect={(e) => keepOpen(e, () => useViewer.getState().setShadows(!shadows))}
        >
          <Contrast className="h-4 w-4" />
          <span>{i18n._({ id: 'viewer.display.shadows', message: 'Shadows' })}</span>
          <span className="ml-auto text-muted-foreground text-xs">
            {shadows
              ? i18n._({ id: 'viewer.common.on', message: 'On' })
              : i18n._({ id: 'viewer.common.off', message: 'Off' })}
          </span>
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={(e) =>
            keepOpen(e, () =>
              useViewer
                .getState()
                .setCameraMode(cameraMode === 'perspective' ? 'orthographic' : 'perspective'),
            )
          }
        >
          <Camera className="h-4 w-4" />
          <span>{i18n._({ id: 'viewer.display.camera', message: 'Camera' })}</span>
          <span className="ml-auto text-muted-foreground text-xs">
            {cameraMode === 'perspective'
              ? i18n._({ id: 'viewer.display.perspective', message: 'Perspective' })
              : i18n._({ id: 'viewer.display.orthographic', message: 'Orthographic' })}
          </span>
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={(e) => keepOpen(e, () => useViewer.getState().setTextures(!textures))}
        >
          {textures ? <Palette className="h-4 w-4" /> : <Square className="h-4 w-4" />}
          <span>{i18n._({ id: 'viewer.display.colors', message: 'Colors' })}</span>
          <span className="ml-auto text-muted-foreground text-xs">
            {textures
              ? i18n._({ id: 'viewer.display.colored', message: 'Colored' })
              : i18n._({ id: 'viewer.display.monochrome', message: 'Monochrome' })}
          </span>
        </DropdownMenuItem>

        <DropdownMenuSeparator />

        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <activeShading.icon className="h-4 w-4" />
            <span>{i18n._({ id: 'viewer.display.render.title', message: 'Render' })}</span>
            <span className="ml-auto text-muted-foreground text-xs">{activeShading.name}</span>
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="dark min-w-56">
            {shadingOptions.map((option) => {
              const OptionIcon = option.icon
              return (
                <DropdownMenuItem
                  key={option.id}
                  onSelect={() => useViewer.getState().setShading(option.id)}
                >
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
            <SwatchBook className="h-4 w-4" />
            <span>{i18n._({ id: 'viewer.theme.title', message: 'Scene theme' })}</span>
            <span className="ml-auto truncate text-muted-foreground text-xs">
              {sceneThemeName(activeTheme.id, activeTheme.name, i18n)}
            </span>
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="dark min-w-48">
            {SCENE_THEMES.map((theme) => {
              const swatches = (['wall', 'roof', 'floor', 'glazing'] as const).map(
                (role) => theme.clayTints?.[role] ?? CLAY_PALETTE[role],
              )
              return (
                <DropdownMenuItem
                  className="gap-2"
                  key={theme.id}
                  onSelect={() => useViewer.getState().setSceneTheme(theme.id)}
                >
                  <span
                    className="grid h-5 w-5 shrink-0 grid-cols-2 overflow-hidden rounded-sm border border-black/10"
                    style={{ backgroundColor: theme.background }}
                  >
                    {swatches.map((color, index) => (
                      <span key={`${theme.id}-${index}`} style={{ backgroundColor: color }} />
                    ))}
                  </span>
                  <span>{sceneThemeName(theme.id, theme.name, i18n)}</span>
                  {sceneTheme === theme.id ? <Check className="ml-auto h-4 w-4" /> : null}
                </DropdownMenuItem>
              )
            })}
          </DropdownMenuSubContent>
        </DropdownMenuSub>

        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <PenLine className="h-4 w-4" />
            <span>{i18n._({ id: 'viewer.display.edges.title', message: 'Edges' })}</span>
            <span className="ml-auto text-muted-foreground text-xs">{activeEdges.name}</span>
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="dark min-w-56">
            {edgeOptions.map((option) => (
              <DropdownMenuItem
                key={option.id}
                onSelect={() => useViewer.getState().setEdges(option.id)}
              >
                <div className="flex flex-col">
                  <span className="text-foreground">{option.name}</span>
                  <span className="text-muted-foreground text-xs">{option.detail}</span>
                </div>
                {edges === option.id ? <Check className="ml-auto h-4 w-4 text-foreground" /> : null}
              </DropdownMenuItem>
            ))}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export type ViewerControlsBarProps = {
  canShowScans?: boolean
  canShowGuides?: boolean
  /** A baked GLB is the active artifact: hide controls it can't honor (wall
   *  modes aren't baked into the GLB). */
  glbActive?: boolean
  /** In GLB mode, whether scans/guides were re-added from scene data — so the
   *  visibility control surfaces the matching toggle even though the artifact
   *  itself carries none. */
  glbHasScans?: boolean
  glbHasGuides?: boolean
  walkthroughActive?: boolean
  onWalkthroughToggle: () => void
  className?: string
}

export const ViewerControlsBar = ({
  canShowScans = true,
  canShowGuides = true,
  glbActive = false,
  glbHasScans = false,
  glbHasGuides = false,
  walkthroughActive = false,
  onWalkthroughToggle,
  className,
}: ViewerControlsBarProps) => {
  const i18n = usePascalI18n()
  const levelMode = useViewer((s) => s.levelMode)
  const wallMode = useViewer((s) => s.wallMode)
  // Sessions may carry a stale mode outside the cycle (e.g. the retired
  // 'translucent'); render and cycle it as cutaway instead of crashing.
  const safeWallMode = (
    wallMode in wallModeConfig ? wallMode : 'cutaway'
  ) as keyof typeof wallModeConfig

  return (
    <div
      className={cn(
        'dark absolute bottom-4 left-1/2 z-20 -translate-x-1/2 text-foreground sm:bottom-6',
        className,
      )}
    >
      <TooltipProvider delayDuration={0}>
        <div className="corner-smooth pointer-events-auto flex h-12 max-w-[calc(100vw-1rem)] flex-row items-center justify-center gap-0.5 overflow-hidden rounded-2xl border border-border/40 bg-background/95 p-1 shadow-elevation-4 backdrop-blur-xl transition-colors duration-200 ease-out sm:h-14 sm:gap-1.5 sm:p-1.5">
          {((canShowScans && (!glbActive || glbHasScans)) ||
            (canShowGuides && (!glbActive || glbHasGuides))) && (
            <>
              <VisibilityMenu
                canShowGuides={canShowGuides && (!glbActive || glbHasGuides)}
                canShowScans={canShowScans && (!glbActive || glbHasScans)}
              />
              <div className="mx-1 h-5 w-px bg-border/40" />
            </>
          )}

          {/* Level mode */}
          <ActionButton
            className={
              levelMode === 'stacked'
                ? 'hover:bg-white/5 hover:text-amber-400'
                : 'bg-amber-500/20 text-amber-400'
            }
            label={i18n._({
              id: 'viewer.levels.label',
              message: 'Levels: {mode}',
              values: { mode: levelModeLabel(levelMode, i18n) },
            })}
            onClick={() => {
              if (levelMode === 'manual') return useViewer.getState().setLevelMode('stacked')
              const modes: ('stacked' | 'exploded' | 'solo')[] = ['stacked', 'exploded', 'solo']
              const nextIndex = (modes.indexOf(levelMode as any) + 1) % modes.length
              useViewer.getState().setLevelMode(modes[nextIndex] ?? 'stacked')
            }}
            size="icon"
            tooltipClassName="dark"
            tooltipSide="top"
            variant="ghost"
          >
            {levelMode === 'solo' && <Diamond className="h-6 w-6" />}
            {levelMode === 'exploded' && <Layers2 className="h-6 w-6" />}
            {(levelMode === 'stacked' || levelMode === 'manual') && <Layers className="h-6 w-6" />}
          </ActionButton>

          {/* Wall mode — parametric only; baked GLB walls are fixed-height. */}
          {!glbActive && (
            <ActionButton
              className={
                safeWallMode === 'cutaway'
                  ? 'opacity-60 grayscale hover:bg-white/5 hover:opacity-100 hover:grayscale-0'
                  : 'bg-white/10'
              }
              label={i18n._({
                id: 'viewer.walls.label',
                message: 'Walls: {mode}',
                values: { mode: wallModeLabel(safeWallMode, i18n) },
              })}
              onClick={() => {
                const modes: ('cutaway' | 'up' | 'down')[] = ['cutaway', 'up', 'down']
                const nextIndex = (modes.indexOf(safeWallMode) + 1) % modes.length
                useViewer.getState().setWallMode(modes[nextIndex] ?? 'cutaway')
              }}
              size="icon"
              tooltipClassName="dark"
              tooltipSide="top"
              variant="ghost"
            >
              <img
                alt={wallModeLabel(safeWallMode, i18n)}
                className="h-[28px] w-[28px]"
                height={28}
                src={wallModeConfig[safeWallMode].icon}
                width={28}
              />
            </ActionButton>
          )}

          <div className="mx-1 h-5 w-px bg-border/40" />

          <DisplayMenu />

          <div className="mx-1 h-5 w-px bg-border/40" />

          {/* Walkthrough */}
          <ActionButton
            className={
              walkthroughActive
                ? 'bg-emerald-500/20 text-emerald-400'
                : 'hover:bg-white/5 hover:text-emerald-400'
            }
            label={i18n._({
              id: 'viewer.walkthrough.label',
              message: 'Walkthrough: {state}',
              values: {
                state: walkthroughActive
                  ? i18n._({ id: 'viewer.common.on', message: 'On' })
                  : i18n._({ id: 'viewer.common.off', message: 'Off' }),
              },
            })}
            onClick={onWalkthroughToggle}
            size="icon"
            tooltipClassName="dark"
            tooltipSide="top"
            variant="ghost"
          >
            <Footprints className="h-6 w-6" />
          </ActionButton>

          <div className="mx-1 h-5 w-px bg-border/40" />

          {/* Follow Pascal */}
          <FollowPascalToggle className="hidden sm:inline-flex" tooltipClassName="dark" />

          {/* Camera actions */}
          <ActionButton
            className="group hidden hover:bg-white/5 sm:inline-flex"
            label={i18n._({ id: 'viewer.camera.orbitLeft', message: 'Orbit left' })}
            onClick={() => emitter.emit('camera-controls:orbit-ccw')}
            size="icon"
            tooltipClassName="dark"
            tooltipSide="top"
            variant="ghost"
          >
            <img
              alt={i18n._({ id: 'viewer.camera.orbitLeft', message: 'Orbit left' })}
              className="h-[28px] w-[28px] -scale-x-100 object-contain opacity-70 transition-opacity group-hover:opacity-100"
              src="/icons/rotate.webp"
            />
          </ActionButton>

          <ActionButton
            className="group hidden hover:bg-white/5 sm:inline-flex"
            label={i18n._({ id: 'viewer.camera.orbitRight', message: 'Orbit right' })}
            onClick={() => emitter.emit('camera-controls:orbit-cw')}
            size="icon"
            tooltipClassName="dark"
            tooltipSide="top"
            variant="ghost"
          >
            <img
              alt={i18n._({ id: 'viewer.camera.orbitRight', message: 'Orbit right' })}
              className="h-[28px] w-[28px] object-contain opacity-70 transition-opacity group-hover:opacity-100"
              src="/icons/rotate.webp"
            />
          </ActionButton>

          <ActionButton
            className="group hover:bg-white/5"
            label={i18n._({ id: 'viewer.camera.topView', message: 'Top view' })}
            onClick={() => emitter.emit('camera-controls:top-view')}
            size="icon"
            tooltipClassName="dark"
            tooltipSide="top"
            variant="ghost"
          >
            <img
              alt={i18n._({ id: 'viewer.camera.topView', message: 'Top view' })}
              className="h-[28px] w-[28px] object-contain opacity-70 transition-opacity group-hover:opacity-100"
              src="/icons/topview.webp"
            />
          </ActionButton>
        </div>
      </TooltipProvider>
    </div>
  )
}

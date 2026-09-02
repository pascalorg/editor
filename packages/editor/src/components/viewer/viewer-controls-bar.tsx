'use client'

import { emitter } from '@pascal-app/core'
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
import { useTranslations } from '../../lib/i18n'
import { cn } from '../../lib/utils'
import { ActionButton } from '../ui/action-menu/action-button'
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

type LevelModeKey = 'stacked' | 'exploded' | 'solo'
type WallModeKey = 'up' | 'cutaway' | 'down'

const LEVEL_MODE_KEYS: ReadonlyArray<LevelModeKey> = ['stacked', 'exploded', 'solo']
const WALL_MODE_KEYS: ReadonlyArray<WallModeKey> = ['cutaway', 'up', 'down']

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
  const t = useTranslations()
  const showScans = useViewer((s) => s.showScans)
  const showGuides = useViewer((s) => s.showGuides)
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <ActionButton
          className="hover:bg-white/5 hover:text-foreground"
          label={t('editor.visibility')}
          size="icon"
          tooltipSide="top"
          variant="ghost"
        >
          <Eye className="h-5 w-5" />
        </ActionButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="center" className="min-w-44" side="top">
        {canShowScans && (
          <DropdownMenuItem
            onSelect={(e) => keepOpen(e, () => useViewer.getState().setShowScans(!showScans))}
          >
            <img alt="" className="h-4 w-4 object-contain" src="/icons/mesh.webp" />
            <span>{t('editor.scans')}</span>
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
            <span>{t('editor.guides')}</span>
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

function wallModeLabel(key: WallModeKey, t: ReturnType<typeof useTranslations>): string {
  if (key === 'up') return t('editor.fullHeight')
  if (key === 'down') return t('editor.low')
  return t('editor.cutaway')
}

function wallModeAlt(key: WallModeKey, t: ReturnType<typeof useTranslations>): string {
  return wallModeLabel(key, t)
}

function wallModeIconSrc(key: WallModeKey): string {
  if (key === 'up') return '/icons/room.webp'
  if (key === 'down') return '/icons/walllow.webp'
  return '/icons/wallcut.webp'
}

function levelModeLabel(key: LevelModeKey, t: ReturnType<typeof useTranslations>): string {
  if (key === 'stacked') return t('editor.stacked')
  if (key === 'exploded') return t('editor.exploded')
  return t('editor.solo')
}

// One "Display" button gathering shadows, camera projection, colors, render
// mode, scene theme and edges.
function DisplayMenu() {
  const t = useTranslations()
  const cameraMode = useViewer((s) => s.cameraMode)
  const shading = useViewer((s) => s.shading)
  const textures = useViewer((s) => s.textures)
  const shadows = useViewer((s) => s.shadows)
  const sceneTheme = useViewer((s) => s.sceneTheme)
  const edges = useViewer((s) => s.edges)
  const activeShadingName = shading === 'rendered' ? t('editor.rendered') : t('editor.solid')
  const activeEdgesName =
    edges === 'soft' ? t('editor.edgeSoft') : edges === 'strong' ? t('editor.edgeStrong') : t('editor.edgeOff')
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <ActionButton
          className="hover:bg-white/5 hover:text-foreground"
          label={t('editor.displaySettings')}
          size="icon"
          tooltipSide="top"
          variant="ghost"
        >
          <SlidersHorizontal className="h-5 w-5" />
        </ActionButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="center" className="min-w-56" side="top">
        <DropdownMenuItem
          onSelect={(e) => keepOpen(e, () => useViewer.getState().setShadows(!shadows))}
        >
          <Contrast className="h-4 w-4" />
          <span>{t('editor.shadows')}</span>
          <span className="ml-auto text-muted-foreground text-xs">
            {shadows ? t('editor.on') : t('editor.off')}
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
          <span>{t('editor.camera')}</span>
          <span className="ml-auto text-muted-foreground text-xs">
            {cameraMode === 'perspective' ? t('editor.perspective') : t('editor.orthographic')}
          </span>
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={(e) => keepOpen(e, () => useViewer.getState().setTextures(!textures))}
        >
          {textures ? <Palette className="h-4 w-4" /> : <Square className="h-4 w-4" />}
          <span>{t('editor.colors')}</span>
          <span className="ml-auto text-muted-foreground text-xs">
            {textures ? t('editor.colored') : t('editor.monochrome')}
          </span>
        </DropdownMenuItem>

        <DropdownMenuSeparator />

        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            {shading === 'rendered' ? (
              <Sparkles className="h-4 w-4" />
            ) : (
              <Box className="h-4 w-4" />
            )}
            <span>{t('editor.render')}</span>
            <span className="ml-auto text-muted-foreground text-xs">{activeShadingName}</span>
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="min-w-56">
            <DropdownMenuItem
              onSelect={() => useViewer.getState().setShading('solid')}
            >
              <Box className="h-4 w-4" />
              <div className="flex flex-col">
                <span className="text-foreground">{t('editor.solid')}</span>
                <span className="text-muted-foreground text-xs">{t('editor.solidDetail')}</span>
              </div>
              {shading === 'solid' ? (
                <Check className="ml-auto h-4 w-4 text-foreground" />
              ) : null}
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => useViewer.getState().setShading('rendered')}
            >
              <Sparkles className="h-4 w-4" />
              <div className="flex flex-col">
                <span className="text-foreground">{t('editor.rendered')}</span>
                <span className="text-muted-foreground text-xs">
                  {t('editor.renderedDetail')}
                </span>
              </div>
              {shading === 'rendered' ? (
                <Check className="ml-auto h-4 w-4 text-foreground" />
              ) : null}
            </DropdownMenuItem>
          </DropdownMenuSubContent>
        </DropdownMenuSub>

        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <SwatchBook className="h-4 w-4" />
            <span>{t('editor.theme')}</span>
            <span className="ml-auto truncate text-muted-foreground text-xs">
              {activeTheme.name}
            </span>
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="min-w-48">
            {SCENE_THEMES.map((t) => {
              const swatches = ((['wall', 'roof', 'floor', 'glazing'] as const)).map(
                (role) => t.clayTints?.[role] ?? CLAY_PALETTE[role],
              )
              return (
                <DropdownMenuItem
                  className="gap-2"
                  key={t.id}
                  onSelect={() => useViewer.getState().setSceneTheme(t.id)}
                >
                  <span
                    className="grid h-5 w-5 shrink-0 grid-cols-2 overflow-hidden rounded-sm border border-black/10"
                    style={{ backgroundColor: t.background }}
                  >
                    {swatches.map((color, index) => (
                      <span key={`${t.id}-${index}`} style={{ backgroundColor: color }} />
                    ))}
                  </span>
                  <span>{t.name}</span>
                  {sceneTheme === t.id ? <Check className="ml-auto h-4 w-4" /> : null}
                </DropdownMenuItem>
              )
            })}
          </DropdownMenuSubContent>
        </DropdownMenuSub>

        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <PenLine className="h-4 w-4" />
            <span>{t('editor.edges')}</span>
            <span className="ml-auto text-muted-foreground text-xs">{activeEdgesName}</span>
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="min-w-56">
            <DropdownMenuItem
              onSelect={() => useViewer.getState().setEdges('off')}
            >
              <div className="flex flex-col">
                <span className="text-foreground">{t('editor.edgeOff')}</span>
                <span className="text-muted-foreground text-xs">{t('editor.edgeOffDetail')}</span>
              </div>
              {edges === 'off' ? (
                <Check className="ml-auto h-4 w-4 text-foreground" />
              ) : null}
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => useViewer.getState().setEdges('soft')}
            >
              <div className="flex flex-col">
                <span className="text-foreground">{t('editor.edgeSoft')}</span>
                <span className="text-muted-foreground text-xs">{t('editor.edgeSoftDetail')}</span>
              </div>
              {edges === 'soft' ? (
                <Check className="ml-auto h-4 w-4 text-foreground" />
              ) : null}
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => useViewer.getState().setEdges('strong')}
            >
              <div className="flex flex-col">
                <span className="text-foreground">{t('editor.edgeStrong')}</span>
                <span className="text-muted-foreground text-xs">
                  {t('editor.edgeStrongDetail')}
                </span>
              </div>
              {edges === 'strong' ? (
                <Check className="ml-auto h-4 w-4 text-foreground" />
              ) : null}
            </DropdownMenuItem>
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
  const t = useTranslations()
  const levelMode = useViewer((s) => s.levelMode)
  const wallMode = useViewer((s) => s.wallMode)
  // Sessions may carry a stale mode outside the cycle (e.g. the retired
  // 'translucent'); render and cycle it as cutaway instead of crashing.
  const safeWallMode = (WALL_MODE_KEYS.includes(wallMode as WallModeKey)
    ? wallMode
    : 'cutaway') as WallModeKey
  const wallAlt = wallModeAlt(safeWallMode, t)
  const wallSrc = wallModeIconSrc(safeWallMode)
  const levelLabel =
    levelMode === 'manual'
      ? t('editor.manual')
      : levelModeLabel(levelMode as LevelModeKey, t)

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
            label={t('editor.levelsLabel', { mode: levelLabel })}
            onClick={() => {
              if (levelMode === 'manual') return useViewer.getState().setLevelMode('stacked')
              const nextIndex =
                (LEVEL_MODE_KEYS.indexOf(levelMode as LevelModeKey) + 1) % LEVEL_MODE_KEYS.length
              useViewer.getState().setLevelMode(LEVEL_MODE_KEYS[nextIndex] ?? 'stacked')
            }}
            size="icon"
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
              label={t('editor.wallsLabel', { mode: wallModeLabel(safeWallMode, t) })}
              onClick={() => {
                const nextIndex =
                  (WALL_MODE_KEYS.indexOf(safeWallMode) + 1) % WALL_MODE_KEYS.length
                useViewer.getState().setWallMode(WALL_MODE_KEYS[nextIndex] ?? 'cutaway')
              }}
              size="icon"
              tooltipSide="top"
              variant="ghost"
            >
              <img alt={wallAlt} className="h-[28px] w-[28px]" src={wallSrc} />
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
            label={`${t('editor.walkthrough')}: ${walkthroughActive ? t('editor.on') : t('editor.off')}`}
            onClick={onWalkthroughToggle}
            size="icon"
            tooltipSide="top"
            variant="ghost"
          >
            <Footprints className="h-6 w-6" />
          </ActionButton>

          <div className="mx-1 h-5 w-px bg-border/40" />

          {/* Camera actions */}
          <ActionButton
            className="group hidden hover:bg-white/5 sm:inline-flex"
            label={t('editor.orbitLeft')}
            onClick={() => emitter.emit('camera-controls:orbit-ccw')}
            size="icon"
            tooltipSide="top"
            variant="ghost"
          >
            <img
              alt={t('editor.orbitLeft')}
              className="h-[28px] w-[28px] -scale-x-100 object-contain opacity-70 transition-opacity group-hover:opacity-100"
              src="/icons/rotate.webp"
            />
          </ActionButton>

          <ActionButton
            className="group hidden hover:bg-white/5 sm:inline-flex"
            label={t('editor.orbitRight')}
            onClick={() => emitter.emit('camera-controls:orbit-cw')}
            size="icon"
            tooltipSide="top"
            variant="ghost"
          >
            <img
              alt={t('editor.orbitRight')}
              className="h-[28px] w-[28px] object-contain opacity-70 transition-opacity group-hover:opacity-100"
              src="/icons/rotate.webp"
            />
          </ActionButton>

          <ActionButton
            className="group hover:bg-white/5"
            label={t('editor.topView')}
            onClick={() => emitter.emit('camera-controls:top-view')}
            size="icon"
            tooltipSide="top"
            variant="ghost"
          >
            <img
              alt={t('editor.topView')}
              className="h-[28px] w-[28px] object-contain opacity-70 transition-opacity group-hover:opacity-100"
              src="/icons/topview.webp"
            />
          </ActionButton>
        </div>
      </TooltipProvider>
    </div>
  )
}
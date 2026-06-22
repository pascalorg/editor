'use client'

import { Icon } from '@iconify/react'
import {
  type AnyNode,
  type AnyNodeId,
  type BuildingNode,
  emitter,
  getLevelDisplayName,
  type LevelNode,
  useScene,
  type ZoneNode,
} from '@pascal-app/core'
import {
  CLAY_PALETTE,
  type EdgeMode,
  getSceneTheme,
  SCENE_THEMES,
  useViewer,
} from '@pascal-app/viewer'
import {
  ArrowLeft,
  Box,
  Camera,
  Check,
  ChevronRight,
  Diamond,
  Footprints,
  Layers,
  Palette,
  PenLine,
  Sparkles,
  Square,
} from 'lucide-react'
import Link from 'next/link'
import { flushSync } from 'react-dom'
import { useShallow } from 'zustand/react/shallow'
import { cn } from '../lib/utils'
import useEditor from '../store/use-editor'
import { ActionButton } from './ui/action-menu/action-button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './ui/primitives/dropdown-menu'
import { TooltipProvider } from './ui/primitives/tooltip'

type ProjectOwner = {
  id: string
  name: string
  username: string | null
  image: string | null
}

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

const levelModeLabels: Record<'stacked' | 'exploded' | 'solo', string> = {
  stacked: 'Stacked',
  exploded: 'Exploded',
  solo: 'Solo',
}

const levelModeBadgeLabels: Record<'manual' | 'stacked' | 'exploded' | 'solo', string> = {
  manual: 'Stack',
  stacked: 'Stack',
  exploded: 'Exploded',
  solo: 'Solo',
}

const wallModeConfig = {
  up: {
    icon: (props: any) => (
      <img alt="Full Height" height={28} src="/icons/room.webp" width={28} {...props} />
    ),
    label: 'Full Height',
  },
  cutaway: {
    icon: (props: any) => (
      <img alt="Cutaway" height={28} src="/icons/wallcut.webp" width={28} {...props} />
    ),
    label: 'Cutaway',
  },
  down: {
    icon: (props: any) => (
      <img alt="Low" height={28} src="/icons/walllow.webp" width={28} {...props} />
    ),
    label: 'Low',
  },
  translucent: {
    icon: (props: any) => (
      <img alt="Translucent" height={28} src="/icons/wall.png" width={28} {...props} />
    ),
    label: 'Translucent',
  },
}

const SHADING_OPTIONS = [
  { id: 'solid', name: 'Solid', detail: 'Flat and fast — no ambient occlusion', icon: Box },
  { id: 'rendered', name: 'Rendered', detail: 'Full ambient occlusion', icon: Sparkles },
] as const

const TEXTURE_OPTIONS = [
  { id: true, name: 'Colored', detail: 'Show materials, textures & colors', icon: Palette },
  { id: false, name: 'Monochrome', detail: 'Flat clay surfaces by role', icon: Square },
] as const

function RenderModeMenu() {
  const shading = useViewer((s) => s.shading)
  const textures = useViewer((s) => s.textures)
  const active = SHADING_OPTIONS.find((o) => o.id === shading) ?? SHADING_OPTIONS[0]
  const ActiveIcon = active.icon
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <ActionButton
          className="text-muted-foreground/80 hover:bg-white/5 hover:text-foreground"
          label={`Render: ${active.name}`}
          size="icon"
          tooltipSide="top"
          variant="ghost"
        >
          <ActiveIcon className="h-6 w-6" />
        </ActionButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="center" className="min-w-56" side="top">
        {SHADING_OPTIONS.map((option) => {
          const OptionIcon = option.icon
          return (
            <DropdownMenuItem
              key={option.id}
              onSelect={() => useViewer.getState().setShading(option.id)}
            >
              <OptionIcon />
              <div className="flex flex-col">
                <span className="text-foreground">{option.name}</span>
                <span className="text-muted-foreground text-xs">{option.detail}</span>
              </div>
              {shading === option.id ? <Check className="ml-auto text-foreground" /> : null}
            </DropdownMenuItem>
          )
        })}
        <DropdownMenuSeparator />
        {TEXTURE_OPTIONS.map((option) => {
          const OptionIcon = option.icon
          return (
            <DropdownMenuItem
              key={option.name}
              onSelect={() => useViewer.getState().setTextures(option.id)}
            >
              <OptionIcon />
              <div className="flex flex-col">
                <span className="text-foreground">{option.name}</span>
                <span className="text-muted-foreground text-xs">{option.detail}</span>
              </div>
              {textures === option.id ? <Check className="ml-auto text-foreground" /> : null}
            </DropdownMenuItem>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function SceneThemeMenu() {
  const sceneTheme = useViewer((s) => s.sceneTheme)
  const active = getSceneTheme(sceneTheme)
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <ActionButton
          className="text-muted-foreground/80 hover:bg-white/5 hover:text-foreground"
          label={`Theme: ${active.name}`}
          size="icon"
          tooltipSide="top"
          variant="ghost"
        >
          <Icon color="currentColor" height={24} icon="lucide:swatch-book" width={24} />
        </ActionButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="center" className="min-w-48" side="top">
        {SCENE_THEMES.map((sceneThemeOption) => {
          const swatches = (['wall', 'roof', 'floor', 'glazing'] as const).map(
            (role) => sceneThemeOption.clayTints?.[role] ?? CLAY_PALETTE[role],
          )
          return (
            <DropdownMenuItem
              key={sceneThemeOption.id}
              onSelect={() => useViewer.getState().setSceneTheme(sceneThemeOption.id)}
            >
              <span
                className="grid h-5 w-5 shrink-0 grid-cols-2 overflow-hidden rounded-sm border border-black/10"
                style={{ backgroundColor: sceneThemeOption.background }}
              >
                {swatches.map((color, index) => (
                  <span
                    key={`${sceneThemeOption.id}-${index}`}
                    style={{ backgroundColor: color }}
                  />
                ))}
              </span>
              <span className="text-foreground">{sceneThemeOption.name}</span>
              {sceneTheme === sceneThemeOption.id ? (
                <Check className="ml-auto text-foreground" />
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
  const edges = useViewer((s) => s.edges)
  const active = EDGE_OPTIONS.find((o) => o.id === edges) ?? EDGE_OPTIONS[0]
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <ActionButton
          className={
            edges === 'off'
              ? 'text-muted-foreground/80 hover:bg-white/5 hover:text-foreground'
              : 'bg-white/10 text-foreground'
          }
          label={`Edges: ${active.name}`}
          size="icon"
          tooltipSide="top"
          variant="ghost"
        >
          <PenLine className="h-6 w-6" />
        </ActionButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="center" className="min-w-56" side="top">
        {EDGE_OPTIONS.map((option) => (
          <DropdownMenuItem
            key={option.id}
            onSelect={() => useViewer.getState().setEdges(option.id)}
          >
            <div className="flex flex-col">
              <span className="text-foreground">{option.name}</span>
              <span className="text-muted-foreground text-xs">{option.detail}</span>
            </div>
            {edges === option.id ? <Check className="ml-auto text-foreground" /> : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

const getNodeName = (node: AnyNode): string => {
  if ('name' in node && node.name) return node.name
  if (node.type === 'wall') return 'Wall'
  if (node.type === 'fence') return 'Fence'
  if (node.type === 'item') return (node as { asset: { name: string } }).asset?.name || 'Item'
  if (node.type === 'slab') return 'Slab'
  if (node.type === 'ceiling') return 'Ceiling'
  if (node.type === 'roof') return 'Roof'
  if (node.type === 'roof-segment') return 'Roof Segment'
  return node.type
}

interface ViewerOverlayProps {
  projectName?: string | null
  owner?: ProjectOwner | null
  canShowScans?: boolean
  canShowGuides?: boolean
  onBack?: () => void
}

export const ViewerOverlay = ({
  projectName,
  owner,
  canShowScans = true,
  canShowGuides = true,
  onBack,
}: ViewerOverlayProps) => {
  const selection = useViewer((s) => s.selection)
  const showScans = useViewer((s) => s.showScans)
  const showGuides = useViewer((s) => s.showGuides)
  const cameraMode = useViewer((s) => s.cameraMode)
  const levelMode = useViewer((s) => s.levelMode)
  const wallMode = useViewer((s) => s.wallMode)

  // Subscribe only to the specific nodes we read so that creating an unrelated
  // node elsewhere in the scene doesn't re-render this overlay.
  const firstSelectedId = selection.selectedIds[0] ?? null
  const building = useScene((s) =>
    selection.buildingId ? (s.nodes[selection.buildingId] as BuildingNode | undefined) : null,
  )
  const level = useScene((s) =>
    selection.levelId ? (s.nodes[selection.levelId] as LevelNode | undefined) : null,
  )
  const zone = useScene((s) =>
    selection.zoneId ? (s.nodes[selection.zoneId] as ZoneNode | undefined) : null,
  )
  const selectedNode = useScene((s) =>
    firstSelectedId ? (s.nodes[firstSelectedId as AnyNodeId] as AnyNode | undefined) : null,
  )
  const levels = useScene(
    useShallow((s) => {
      if (!building) return []
      return building.children
        .map((id) => s.nodes[id as AnyNodeId] as LevelNode | undefined)
        .filter((n): n is LevelNode => n?.type === 'level')
        .sort((a, b) => a.level - b.level)
    }),
  )

  const handleLevelClick = (levelId: LevelNode['id']) => {
    // When switching levels, deselect zone and items
    useViewer.getState().setSelection({ levelId })
  }

  const handleBreadcrumbClick = (depth: 'root' | 'building' | 'level' | 'zone') => {
    switch (depth) {
      case 'root':
        useViewer.getState().resetSelection()
        break
      case 'building':
        useViewer.getState().setSelection({ levelId: null })
        break
      case 'level':
        useViewer.getState().setSelection({ zoneId: null })
        break
    }
  }

  return (
    <>
      {/* Unified top-left card */}
      <div className="dark absolute top-4 left-4 z-20 flex flex-col gap-3 text-foreground">
        <div className="pointer-events-auto flex min-w-[200px] flex-col overflow-hidden rounded-2xl border border-border/40 bg-background/95 shadow-lg backdrop-blur-xl transition-colors duration-200 ease-out">
          {/* Project info + back */}
          <div className="flex items-center gap-3 px-3 py-2.5">
            {onBack ? (
              <button
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition-colors hover:bg-white/10"
                onClick={onBack}
              >
                <ArrowLeft className="h-4 w-4 text-muted-foreground" />
              </button>
            ) : (
              <Link
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition-colors hover:bg-white/10"
                href="/"
              >
                <ArrowLeft className="h-4 w-4 text-muted-foreground" />
              </Link>
            )}
            <div className="min-w-0">
              <div className="truncate font-medium text-foreground text-sm">
                {projectName || 'Untitled'}
              </div>
              {owner?.username && (
                <Link
                  className="text-muted-foreground text-xs transition-colors hover:text-foreground"
                  href={`/u/${owner.username}`}
                >
                  @{owner.username}
                </Link>
              )}
            </div>
          </div>

          {/* Breadcrumb — only shown when navigated into a building */}
          {building && (
            <div className="border-border/40 border-t px-3 py-2">
              <div className="flex items-center gap-1.5 text-xs">
                <button
                  className="text-muted-foreground transition-colors hover:text-foreground"
                  onClick={() => handleBreadcrumbClick('root')}
                >
                  Site
                </button>

                {building && (
                  <>
                    <ChevronRight className="h-3 w-3 text-muted-foreground/50" />
                    <button
                      className={`truncate transition-colors ${level ? 'text-muted-foreground hover:text-foreground' : 'font-medium text-foreground'}`}
                      onClick={() => handleBreadcrumbClick('building')}
                    >
                      {building.name || 'Building'}
                    </button>
                  </>
                )}

                {level && (
                  <>
                    <ChevronRight className="h-3 w-3 text-muted-foreground/50" />
                    <button
                      className={`truncate transition-colors ${zone ? 'text-muted-foreground hover:text-foreground' : 'font-medium text-foreground'}`}
                      onClick={() => handleBreadcrumbClick('level')}
                    >
                      {getLevelDisplayName(level)}
                    </button>
                  </>
                )}

                {zone && (
                  <>
                    <ChevronRight className="h-3 w-3 text-muted-foreground/50" />
                    <span
                      className={`truncate transition-colors ${selectedNode ? 'text-muted-foreground' : 'font-medium text-foreground'}`}
                    >
                      {zone.name}
                    </span>
                  </>
                )}

                {selectedNode && zone && (
                  <>
                    <ChevronRight className="h-3 w-3 text-muted-foreground/50" />
                    <span className="truncate font-medium text-foreground">
                      {getNodeName(selectedNode)}
                    </span>
                  </>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Level List (only when building is selected) */}
        {building && levels.length > 0 && (
          <div className="pointer-events-auto flex w-48 flex-col overflow-hidden rounded-2xl border border-border/40 bg-background/95 py-1 shadow-lg backdrop-blur-xl transition-colors duration-200 ease-out">
            <span className="px-3 py-2 font-medium text-[10px] text-muted-foreground uppercase tracking-wider">
              Levels
            </span>
            <div className="flex flex-col">
              {levels.map((lvl) => {
                const isSelected = lvl.id === selection.levelId
                return (
                  <button
                    className={cn(
                      'group/row relative flex h-8 w-full cursor-pointer select-none items-center border-border/50 border-r border-r-transparent border-b px-3 text-sm transition-all duration-200',
                      isSelected
                        ? 'border-r-3 border-r-white bg-accent/50 text-foreground'
                        : 'text-muted-foreground hover:bg-accent/30 hover:text-foreground',
                    )}
                    key={lvl.id}
                    onClick={() => handleLevelClick(lvl.id)}
                  >
                    <div className="flex min-w-0 flex-1 items-center gap-2">
                      <span
                        className={cn(
                          'flex h-4 w-4 shrink-0 items-center justify-center transition-all duration-200',
                          !isSelected && 'opacity-60 grayscale',
                        )}
                      >
                        <Layers className="h-3.5 w-3.5" />
                      </span>
                      <div className="min-w-0 flex-1 truncate text-left">
                        {lvl.name || `Level ${lvl.level}`}
                      </div>
                    </div>
                  </button>
                )
              })}
            </div>
          </div>
        )}
      </div>

      {/* Controls Panel - Bottom Center */}
      <div className="dark absolute bottom-6 left-1/2 z-20 -translate-x-1/2 text-foreground">
        <TooltipProvider delayDuration={0}>
          <div className="pointer-events-auto flex h-14 flex-row items-center justify-center gap-1.5 rounded-2xl border border-border/40 bg-background/95 p-1.5 shadow-lg backdrop-blur-xl transition-colors duration-200 ease-out">
            {/* Scans and Guides Visibility */}
            {canShowScans && (
              <ActionButton
                className={
                  showScans
                    ? 'bg-white/10'
                    : 'opacity-60 grayscale hover:bg-white/5 hover:opacity-100 hover:grayscale-0'
                }
                label={`Scans: ${showScans ? 'Visible' : 'Hidden'}`}
                onClick={() => useViewer.getState().setShowScans(!showScans)}
                size="icon"
                tooltipSide="top"
                variant="ghost"
              >
                <img
                  alt="Scans"
                  className="h-[28px] w-[28px] object-contain"
                  src="/icons/mesh.webp"
                />
              </ActionButton>
            )}

            {canShowGuides && (
              <ActionButton
                className={
                  showGuides
                    ? 'bg-white/10'
                    : 'opacity-60 grayscale hover:bg-white/5 hover:opacity-100 hover:grayscale-0'
                }
                label={`Guides: ${showGuides ? 'Visible' : 'Hidden'}`}
                onClick={() => useViewer.getState().setShowGuides(!showGuides)}
                size="icon"
                tooltipSide="top"
                variant="ghost"
              >
                <img
                  alt="Guides"
                  className="h-[28px] w-[28px] object-contain"
                  src="/icons/floorplan.webp"
                />
              </ActionButton>
            )}

            {(canShowScans || canShowGuides) && <div className="mx-1 h-5 w-px bg-border/40" />}

            {/* Camera Mode */}
            <ActionButton
              className={
                cameraMode === 'orthographic'
                  ? 'bg-violet-500/20 text-violet-400'
                  : 'hover:bg-white/5 hover:text-violet-400'
              }
              label={`Camera: ${cameraMode === 'perspective' ? 'Perspective' : 'Orthographic'}`}
              onClick={() =>
                useViewer
                  .getState()
                  .setCameraMode(cameraMode === 'perspective' ? 'orthographic' : 'perspective')
              }
              size="icon"
              tooltipSide="top"
              variant="ghost"
            >
              <Camera className="h-6 w-6" />
            </ActionButton>

            <RenderModeMenu />

            <SceneThemeMenu />

            <EdgesMenu />

            {/* Level Mode */}
            <ActionButton
              className={cn(
                'p-0',
                levelMode === 'stacked' || levelMode === 'manual'
                  ? 'text-muted-foreground/80 hover:bg-white/5 hover:text-foreground'
                  : 'bg-white/10 text-foreground',
              )}
              label={`Levels: ${levelMode === 'manual' ? 'Manual' : levelModeLabels[levelMode as keyof typeof levelModeLabels]}`}
              onClick={() => {
                if (levelMode === 'manual') return useViewer.getState().setLevelMode('stacked')
                const modes: ('stacked' | 'exploded' | 'solo')[] = ['stacked', 'exploded', 'solo']
                const nextIndex = (modes.indexOf(levelMode as any) + 1) % modes.length
                useViewer.getState().setLevelMode(modes[nextIndex] ?? 'stacked')
              }}
              size="icon"
              tooltipSide="top"
              variant="ghost"
            >
              <span className="relative flex h-full w-full items-center justify-center pb-1">
                {levelMode === 'solo' && <Diamond className="h-6 w-6" />}
                {levelMode === 'exploded' && (
                  <Icon color="currentColor" height={24} icon="charm:stack-pop" width={24} />
                )}
                {(levelMode === 'stacked' || levelMode === 'manual') && (
                  <Icon color="currentColor" height={24} icon="charm:stack-push" width={24} />
                )}
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute right-1 bottom-1 left-1 rounded border border-border/50 bg-background/70 px-0.5 py-[2px] text-center font-medium font-pixel text-[8px] text-foreground/85 leading-none tracking-[-0.02em] backdrop-blur-sm"
                >
                  {levelModeBadgeLabels[levelMode]}
                </span>
              </span>
            </ActionButton>

            {/* Wall Mode */}
            <ActionButton
              className={
                wallMode !== 'cutaway'
                  ? 'bg-white/10'
                  : 'opacity-60 grayscale hover:bg-white/5 hover:opacity-100 hover:grayscale-0'
              }
              label={`Walls: ${wallModeConfig[wallMode as keyof typeof wallModeConfig].label}`}
              onClick={() => {
                const modes: ('cutaway' | 'up' | 'down' | 'translucent')[] = [
                  'cutaway',
                  'up',
                  'down',
                  'translucent',
                ]
                const nextIndex = (modes.indexOf(wallMode as any) + 1) % modes.length
                useViewer.getState().setWallMode(modes[nextIndex] ?? 'cutaway')
              }}
              size="icon"
              tooltipSide="top"
              variant="ghost"
            >
              {(() => {
                const Icon = wallModeConfig[wallMode as keyof typeof wallModeConfig].icon
                return <Icon className="h-[28px] w-[28px]" />
              })()}
            </ActionButton>

            <div className="mx-1 h-5 w-px bg-border/40" />

            {/* Camera Actions */}
            <ActionButton
              className="group hidden hover:bg-white/5 sm:inline-flex"
              label="Orbit Left"
              onClick={() => emitter.emit('camera-controls:orbit-ccw')}
              size="icon"
              tooltipSide="top"
              variant="ghost"
            >
              <img
                alt="Orbit Left"
                className="h-[28px] w-[28px] -scale-x-100 object-contain opacity-70 transition-opacity group-hover:opacity-100"
                src="/icons/rotate.webp"
              />
            </ActionButton>

            <ActionButton
              className="group hidden hover:bg-white/5 sm:inline-flex"
              label="Orbit Right"
              onClick={() => emitter.emit('camera-controls:orbit-cw')}
              size="icon"
              tooltipSide="top"
              variant="ghost"
            >
              <img
                alt="Orbit Right"
                className="h-[28px] w-[28px] object-contain opacity-70 transition-opacity group-hover:opacity-100"
                src="/icons/rotate.webp"
              />
            </ActionButton>

            <ActionButton
              className="group hover:bg-white/5"
              label="Top View"
              onClick={() => emitter.emit('camera-controls:top-view')}
              size="icon"
              tooltipSide="top"
              variant="ghost"
            >
              <img
                alt="Top View"
                className="h-[28px] w-[28px] object-contain opacity-70 transition-opacity group-hover:opacity-100"
                src="/icons/topview.webp"
              />
            </ActionButton>

            <div className="mx-1 h-5 w-px bg-border/40" />

            {/* First-person walkthrough */}
            <ActionButton
              className="hover:bg-white/5 hover:text-emerald-400"
              label="Walkthrough"
              onClick={() => {
                flushSync(() => useEditor.getState().setFirstPersonMode(true))
                requestWalkthroughPointerLock()
              }}
              size="icon"
              tooltipSide="top"
              variant="ghost"
            >
              <Footprints className="h-6 w-6" />
            </ActionButton>
          </div>
        </TooltipProvider>
      </div>
    </>
  )
}

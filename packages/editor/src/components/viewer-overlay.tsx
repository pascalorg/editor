'use client'

import { Icon } from '@iconify/react'
import {
  type AnyNode,
  type AnyNodeId,
  type BuildingNode,
  emitter,
  type LevelNode,
  useScene,
  type ZoneNode,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { ArrowLeft, Camera, ChevronRight, Diamond, Layers, Moon, Sun } from 'lucide-react'
import { motion } from 'motion/react'
import Link from 'next/link'
import { useShallow } from 'zustand/react/shallow'
import { t } from '../i18n'
import { cn } from '../lib/utils'
import { ActionButton } from './ui/action-menu/action-button'
import { TooltipProvider } from './ui/primitives/tooltip'

type ProjectOwner = {
  id: string
  name: string
  username: string | null
  image: string | null
}

function visibilityState(visible: boolean) {
  return visible ? t('common.visible', 'Visible') : t('common.hidden', 'Hidden')
}

function getLevelDisplayName(level: LevelNode) {
  return (
    level.name ||
    t('sidebar.levelFallback', { fallback: 'Level {level}', params: { level: level.level } })
  )
}

function getLevelModeLabels() {
  return {
    stacked: t('actionMenu.levelMode.stacked', 'Stacked'),
    exploded: t('actionMenu.levelMode.exploded', 'Exploded'),
    solo: t('actionMenu.levelMode.solo', 'Solo'),
  }
}

function getLevelModeBadgeLabels() {
  return {
    manual: t('actionMenu.levelMode.stack', 'Stack'),
    stacked: t('actionMenu.levelMode.stack', 'Stack'),
    exploded: t('actionMenu.levelMode.exploded', 'Exploded'),
    solo: t('actionMenu.levelMode.solo', 'Solo'),
  }
}

function getWallModeConfig() {
  const fullHeight = t('actionMenu.wallMode.fullHeight', 'Full Height')
  const cutaway = t('actionMenu.wallMode.cutaway', 'Cutaway')
  const low = t('actionMenu.wallMode.low', 'Low')

  return {
    up: {
      icon: (props: any) => (
        <img alt={fullHeight} height={28} src="/icons/room.webp" width={28} {...props} />
      ),
      label: fullHeight,
    },
    cutaway: {
      icon: (props: any) => (
        <img alt={cutaway} height={28} src="/icons/wallcut.webp" width={28} {...props} />
      ),
      label: cutaway,
    },
    down: {
      icon: (props: any) => (
        <img alt={low} height={28} src="/icons/walllow.webp" width={28} {...props} />
      ),
      label: low,
    },
  }
}

function getCameraModeLabel(mode: 'perspective' | 'orthographic') {
  return mode === 'perspective'
    ? t('toolbar.perspective', 'Perspective')
    : t('toolbar.orthographic', 'Orthographic')
}

const getNodeName = (node: AnyNode): string => {
  if ('name' in node && node.name) return node.name
  if (node.type === 'wall') return 'Wall'
  if (node.type === 'fence') return 'Fence'
  if (node.type === 'road') return '\u5730\u9762\u5e26'
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
  const theme = useViewer((s) => s.theme)

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

  const levelModeLabels = getLevelModeLabels()
  const levelModeBadgeLabels = getLevelModeBadgeLabels()
  const wallModeConfig = getWallModeConfig()

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
                data-testid="preview-exit-button"
                onClick={onBack}
                type="button"
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
                {projectName || t('actionMenu.untitled', 'Untitled')}
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
                  {t('actionMenu.site', 'Site')}
                </button>

                {building && (
                  <>
                    <ChevronRight className="h-3 w-3 text-muted-foreground/50" />
                    <button
                      className={`truncate transition-colors ${level ? 'text-muted-foreground hover:text-foreground' : 'font-medium text-foreground'}`}
                      onClick={() => handleBreadcrumbClick('building')}
                    >
                      {building.name || t('actionMenu.building', 'Building')}
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
              {t('actionMenu.levels', 'Levels')}
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
                        {getLevelDisplayName(lvl)}
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
          <div
            className="pointer-events-auto flex h-14 flex-row items-center justify-center gap-1.5 rounded-2xl border border-white/10 p-1.5 shadow-lg transition-colors duration-200 ease-out"
            style={{ backgroundColor: 'rgba(0, 0, 0, 0.4)' }}
          >
            {/* Theme Toggle */}
            <button
              aria-label={t('actionMenu.toggleTheme', 'Toggle theme')}
              className="flex h-[36px] shrink-0 cursor-pointer items-center rounded-full border border-border/50 bg-accent/50 p-1"
              onClick={() => useViewer.getState().setTheme(theme === 'dark' ? 'light' : 'dark')}
              type="button"
            >
              <div className="relative flex">
                {/* Sliding Background */}
                <motion.div
                  animate={{
                    x: theme === 'light' ? '100%' : '0%',
                  }}
                  className="absolute inset-0 rounded-full bg-white shadow-sm dark:bg-white/20"
                  initial={false}
                  style={{ width: '50%' }}
                  transition={{
                    type: 'spring',
                    stiffness: 500,
                    damping: 35,
                  }}
                />

                {/* Dark Mode Icon */}
                <div
                  className={cn(
                    'pointer-events-none relative z-10 flex h-7 w-9 items-center justify-center rounded-full transition-colors duration-200',
                    theme === 'dark' ? 'text-foreground' : 'text-muted-foreground',
                  )}
                >
                  <Moon className="h-4 w-4" />
                </div>

                {/* Light Mode Icon */}
                <div
                  className={cn(
                    'pointer-events-none relative z-10 flex h-7 w-9 items-center justify-center rounded-full transition-colors duration-200',
                    theme === 'light' ? 'text-foreground' : 'text-muted-foreground',
                  )}
                >
                  <Sun className="h-4 w-4" />
                </div>
              </div>
            </button>

            <div className="mx-1 h-5 w-px bg-border/40" />

            {/* Scans and Guides Visibility */}
            {canShowScans && (
              <ActionButton
                className={
                  showScans
                    ? 'bg-white/10'
                    : 'opacity-60 grayscale hover:bg-white/5 hover:opacity-100 hover:grayscale-0'
                }
                label={t('actionMenu.scansVisibility', {
                  fallback: 'Scans: {state}',
                  params: { state: visibilityState(showScans) },
                })}
                onClick={() => useViewer.getState().setShowScans(!showScans)}
                size="icon"
                tooltipSide="top"
                variant="ghost"
              >
                <img
                  alt={t('actionMenu.scans', 'Scans')}
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
                label={t('actionMenu.guidesVisibility', {
                  fallback: 'Guides: {state}',
                  params: { state: visibilityState(showGuides) },
                })}
                onClick={() => useViewer.getState().setShowGuides(!showGuides)}
                size="icon"
                tooltipSide="top"
                variant="ghost"
              >
                <img
                  alt={t('actionMenu.guides', 'Guides')}
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
              label={t('actionMenu.cameraMode', {
                fallback: 'Camera: {mode}',
                params: { mode: getCameraModeLabel(cameraMode) },
              })}
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

            {/* Level Mode */}
            <ActionButton
              className={cn(
                'p-0',
                levelMode === 'stacked' || levelMode === 'manual'
                  ? 'text-muted-foreground/80 hover:bg-white/5 hover:text-foreground'
                  : 'bg-white/10 text-foreground',
              )}
              label={t('actionMenu.levelsMode', {
                fallback: 'Levels: {mode}',
                params: {
                  mode:
                    levelMode === 'manual'
                      ? t('actionMenu.levelMode.manual', 'Manual')
                      : levelModeLabels[levelMode as keyof typeof levelModeLabels],
                },
              })}
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
              label={t('actionMenu.wallsMode', {
                fallback: 'Walls: {mode}',
                params: { mode: wallModeConfig[wallMode as keyof typeof wallModeConfig].label },
              })}
              onClick={() => {
                const modes: ('cutaway' | 'up' | 'down')[] = ['cutaway', 'up', 'down']
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
              label={t('actionMenu.orbitLeft', 'Orbit Left')}
              onClick={() => emitter.emit('camera-controls:orbit-ccw')}
              size="icon"
              tooltipSide="top"
              variant="ghost"
            >
              <img
                alt={t('actionMenu.orbitLeft', 'Orbit Left')}
                className="h-[28px] w-[28px] -scale-x-100 object-contain opacity-70 transition-opacity group-hover:opacity-100"
                src="/icons/rotate.webp"
              />
            </ActionButton>

            <ActionButton
              className="group hidden hover:bg-white/5 sm:inline-flex"
              label={t('actionMenu.orbitRight', 'Orbit Right')}
              onClick={() => emitter.emit('camera-controls:orbit-cw')}
              size="icon"
              tooltipSide="top"
              variant="ghost"
            >
              <img
                alt={t('actionMenu.orbitRight', 'Orbit Right')}
                className="h-[28px] w-[28px] object-contain opacity-70 transition-opacity group-hover:opacity-100"
                src="/icons/rotate.webp"
              />
            </ActionButton>

            <ActionButton
              className="group hover:bg-white/5"
              label={t('actionMenu.topView', 'Top View')}
              onClick={() => emitter.emit('camera-controls:top-view')}
              size="icon"
              tooltipSide="top"
              variant="ghost"
            >
              <img
                alt={t('actionMenu.topView', 'Top View')}
                className="h-[28px] w-[28px] object-contain opacity-70 transition-opacity group-hover:opacity-100"
                src="/icons/topview.webp"
              />
            </ActionButton>
          </div>
        </TooltipProvider>
      </div>
    </>
  )
}

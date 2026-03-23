'use client'

import {
  type AnyNode,
  type AnyNodeId,
  type BuildingNode,
  emitter,
  type LevelNode,
  useScene,
  type ZoneNode,
} from '@vesper/core'
import { useViewer } from '@vesper/viewer'
import {
  ArrowLeft,
  Camera,
  ChevronRight,
  Diamond,
  Layers,
  Layers2,
  Maximize2,
  Minimize2,
  Moon,
  Scissors,
  Sun,
} from 'lucide-react'
import { motion } from 'motion/react'
import Link from 'next/link'
import { cn } from '../lib/utils'
import { ActionButton } from './ui/action-menu/action-button'
import { TooltipProvider } from './ui/primitives/tooltip'

type ProjectOwner = {
  id: string
  name: string
  username: string | null
  image: string | null
}

const levelModeLabels: Record<'stacked' | 'exploded' | 'solo', string> = {
  stacked: 'Stacked',
  exploded: 'Exploded',
  solo: 'Solo',
}

const wallModeConfig = {
  up: {
    icon: Maximize2,
    label: 'Full Height',
  },
  cutaway: {
    icon: Scissors,
    label: 'Cutaway',
  },
  down: {
    icon: Minimize2,
    label: 'Low',
  },
}

const getNodeName = (node: AnyNode): string => {
  if ('name' in node && node.name) return node.name
  if (node.type === 'wall') return 'Wall'
  if (node.type === 'item') return (node as { asset: { name: string } }).asset?.name || 'Item'
  if (node.type === 'slab') return 'Slab'
  if (node.type === 'ceiling') return 'Ceiling'
  if (node.type === 'roof') return 'Roof'
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
  const nodes = useScene((s) => s.nodes)
  const showScans = useViewer((s) => s.showScans)
  const showGuides = useViewer((s) => s.showGuides)
  const cameraMode = useViewer((s) => s.cameraMode)
  const levelMode = useViewer((s) => s.levelMode)
  const wallMode = useViewer((s) => s.wallMode)
  const theme = useViewer((s) => s.theme)

  const building = selection.buildingId
    ? (nodes[selection.buildingId] as BuildingNode | undefined)
    : null
  const level = selection.levelId ? (nodes[selection.levelId] as LevelNode | undefined) : null
  const zone = selection.zoneId ? (nodes[selection.zoneId] as ZoneNode | undefined) : null

  // Get the first selected item (if any)
  const selectedNode =
    selection.selectedIds.length > 0
      ? (nodes[selection.selectedIds[0] as AnyNodeId] as AnyNode | undefined)
      : null

  // Get all levels for the selected building
  const levels =
    building?.children
      .map((id) => nodes[id as AnyNodeId] as LevelNode | undefined)
      .filter((n): n is LevelNode => n?.type === 'level')
      .sort((a, b) => a.level - b.level) ?? []

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
                      {level.name || `Level ${level.level}`}
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
            {/* Theme Toggle */}
            <button
              aria-label="Toggle theme"
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
                label={`Scans: ${showScans ? 'Visible' : 'Hidden'}`}
                onClick={() => useViewer.getState().setShowScans(!showScans)}
                size="icon"
                tooltipSide="top"
                variant="ghost"
              >
                <img
                  alt="Scans"
                  className="h-[28px] w-[28px] object-contain"
                  src="/icons/mesh.png"
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
                  src="/icons/floorplan.png"
                />
              </ActionButton>
            )}

            {(canShowScans || canShowGuides) && <div className="mx-1 h-5 w-px bg-border/40" />}

            {/* Camera Mode */}
            <ActionButton
              className={
                cameraMode === 'orthographic'
                  ? 'bg-green-500/20 text-green-400'
                  : 'hover:bg-white/5 hover:text-green-400'
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

            {/* Level Mode */}
            <ActionButton
              className={
                levelMode !== 'stacked'
                  ? 'bg-amber-500/20 text-amber-400'
                  : 'hover:bg-white/5 hover:text-amber-400'
              }
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
              {levelMode === 'solo' && <Diamond className="h-6 w-6" />}
              {levelMode === 'exploded' && <Layers2 className="h-6 w-6" />}
              {(levelMode === 'stacked' || levelMode === 'manual') && (
                <Layers className="h-6 w-6" />
              )}
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
              label="Orbit Left"
              onClick={() => emitter.emit('camera-controls:orbit-ccw')}
              size="icon"
              tooltipSide="top"
              variant="ghost"
            >
              <img
                alt="Orbit Left"
                className="h-[28px] w-[28px] -scale-x-100 object-contain opacity-70 transition-opacity group-hover:opacity-100"
                src="/icons/rotate.png"
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
                src="/icons/rotate.png"
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
                src="/icons/topview.png"
              />
            </ActionButton>
          </div>
        </TooltipProvider>
      </div>
    </>
  )
}

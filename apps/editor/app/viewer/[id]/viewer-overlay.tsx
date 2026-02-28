'use client'

import {
  type AnyNode,
  type AnyNodeId,
  type BuildingNode,
  type LevelNode,
  useScene,
  type ZoneNode,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import {
  ArrowLeft,
  Camera,
  ChevronRight,
  Diamond,
  Layers,
  Layers2,
  Moon,
  Sun,
} from 'lucide-react'
import Link from 'next/link'
import { motion } from 'framer-motion'
import { cn } from '@/lib/utils'
import type { ProjectOwner } from '@/features/community/lib/projects/types'
import { ActionButton } from '@/components/ui/action-menu/action-button'
import { TooltipProvider } from '@/components/ui/primitives/tooltip'
import { emitter } from '@pascal-app/core'

const levelModeLabels: Record<'stacked' | 'exploded' | 'solo', string> = {
  stacked: 'Stacked',
  exploded: 'Exploded',
  solo: 'Solo',
}

const wallModeConfig = {
  up: {
    icon: (props: any) => (
      <img alt="Full Height" height={28} src="/icons/room.png" width={28} {...props} />
    ),
    label: 'Full Height',
  },
  cutaway: {
    icon: (props: any) => (
      <img alt="Cutaway" height={28} src="/icons/wallcut.png" width={28} {...props} />
    ),
    label: 'Cutaway',
  },
  down: {
    icon: (props: any) => <img alt="Low" height={28} src="/icons/walllow.png" width={28} {...props} />,
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
}

export const ViewerOverlay = ({
  projectName,
  owner,
  canShowScans = true,
  canShowGuides = true,
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
      <div className="absolute top-4 left-4 z-20 flex flex-col gap-3 dark text-foreground">
        <div className="pointer-events-auto flex flex-col rounded-2xl border border-border/40 bg-background/95 shadow-lg backdrop-blur-xl transition-colors duration-200 ease-out overflow-hidden min-w-[200px]">
          {/* Project info + back */}
          <div className="flex items-center gap-3 px-3 py-2.5">
            <Link
              href="/"
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md hover:bg-white/10 transition-colors"
            >
              <ArrowLeft className="h-4 w-4 text-muted-foreground" />
            </Link>
            <div className="min-w-0">
              <div className="text-sm font-medium text-foreground truncate">
                {projectName || 'Untitled'}
              </div>
              {owner?.username && (
                <Link
                  href={`/u/${owner.username}`}
                  className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  @{owner.username}
                </Link>
              )}
            </div>
          </div>

          {/* Breadcrumb — only shown when navigated into a building */}
          {building && (
            <div className="border-t border-border/40 px-3 py-2">
              <div className="flex items-center gap-1.5 text-xs">
                <button
                  onClick={() => handleBreadcrumbClick('root')}
                  className="text-muted-foreground hover:text-foreground transition-colors"
                >
                  Site
                </button>

                {building && (
                  <>
                    <ChevronRight className="w-3 h-3 text-muted-foreground/50" />
                    <button
                      onClick={() => handleBreadcrumbClick('building')}
                      className={`transition-colors truncate ${level ? 'text-muted-foreground hover:text-foreground' : 'text-foreground font-medium'}`}
                    >
                      {building.name || 'Building'}
                    </button>
                  </>
                )}

                {level && (
                  <>
                    <ChevronRight className="w-3 h-3 text-muted-foreground/50" />
                    <button
                      onClick={() => handleBreadcrumbClick('level')}
                      className={`transition-colors truncate ${zone ? 'text-muted-foreground hover:text-foreground' : 'text-foreground font-medium'}`}
                    >
                      {level.name || `Level ${level.level}`}
                    </button>
                  </>
                )}

                {zone && (
                  <>
                    <ChevronRight className="w-3 h-3 text-muted-foreground/50" />
                    <span
                      className={`transition-colors truncate ${selectedNode ? 'text-muted-foreground' : 'text-foreground font-medium'}`}
                    >
                      {zone.name}
                    </span>
                  </>
                )}

                {selectedNode && zone && (
                  <>
                    <ChevronRight className="w-3 h-3 text-muted-foreground/50" />
                    <span className="text-foreground font-medium truncate">
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
          <div className="pointer-events-auto flex flex-col rounded-2xl border border-border/40 bg-background/95 shadow-lg backdrop-blur-xl transition-colors duration-200 ease-out overflow-hidden w-48 py-1">
            <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider px-3 py-2">Levels</span>
            <div className="flex flex-col">
              {levels.map((lvl) => {
                const isSelected = lvl.id === selection.levelId;
                return (
                  <button
                    key={lvl.id}
                    onClick={() => handleLevelClick(lvl.id)}
                    className={cn(
                      "relative flex items-center h-8 w-full cursor-pointer group/row text-sm select-none border-b border-r border-border/50 border-r-transparent transition-all duration-200 px-3",
                      isSelected
                        ? "bg-accent/50 text-foreground border-r-white border-r-3"
                        : "text-muted-foreground hover:bg-accent/30 hover:text-foreground"
                    )}
                  >
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                      <span className={cn(
                        "w-4 h-4 flex items-center justify-center shrink-0 transition-all duration-200",
                        !isSelected && "opacity-60 grayscale"
                      )}>
                        <Layers className="w-3.5 h-3.5" />
                      </span>
                      <div className="flex-1 min-w-0 truncate text-left">
                        {lvl.name || `Level ${lvl.level}`}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Controls Panel - Bottom Center */}
      <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-20 dark text-foreground">
        <TooltipProvider delayDuration={0}>
          <div className="pointer-events-auto flex flex-row items-center justify-center gap-1.5 rounded-2xl border border-border/40 bg-background/95 p-1.5 shadow-lg backdrop-blur-xl transition-colors duration-200 ease-out h-14">
            {/* Theme Toggle */}
            <button
              className="shrink-0 flex items-center bg-accent/50 rounded-full p-1 border border-border/50 cursor-pointer h-[36px]"
              onClick={() => useViewer.getState().setTheme(theme === 'dark' ? 'light' : 'dark')}
              type="button"
              aria-label="Toggle theme"
            >
              <div className="relative flex">
                {/* Sliding Background */}
                <motion.div
                  className="absolute inset-0 bg-white shadow-sm rounded-full dark:bg-white/20"
                  initial={false}
                  animate={{
                    x: theme === "light" ? "100%" : "0%",
                  }}
                  transition={{
                    type: "spring",
                    stiffness: 500,
                    damping: 35,
                  }}
                  style={{ width: "50%" }}
                />

                {/* Dark Mode Icon */}
                <div
                  className={cn(
                    "relative z-10 flex h-7 w-9 items-center justify-center rounded-full transition-colors duration-200 pointer-events-none",
                    theme === "dark"
                      ? "text-foreground"
                      : "text-muted-foreground"
                  )}
                >
                  <Moon className="h-4 w-4" />
                </div>

                {/* Light Mode Icon */}
                <div
                  className={cn(
                    "relative z-10 flex h-7 w-9 items-center justify-center rounded-full transition-colors duration-200 pointer-events-none",
                    theme === "light"
                      ? "text-foreground"
                      : "text-muted-foreground"
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
                label={`Scans: ${showScans ? 'Visible' : 'Hidden'}`}
                tooltipSide="top"
                className={showScans ? 'bg-white/10' : 'opacity-60 grayscale hover:opacity-100 hover:grayscale-0 hover:bg-white/5'}
                onClick={() => useViewer.getState().setShowScans(!showScans)}
                size="icon"
                variant="ghost"
              >
                <img alt="Scans" className="h-[28px] w-[28px] object-contain" src="/icons/mesh.png" />
              </ActionButton>
            )}

            {canShowGuides && (
              <ActionButton
                label={`Guides: ${showGuides ? 'Visible' : 'Hidden'}`}
                tooltipSide="top"
                className={showGuides ? 'bg-white/10' : 'opacity-60 grayscale hover:opacity-100 hover:grayscale-0 hover:bg-white/5'}
                onClick={() => useViewer.getState().setShowGuides(!showGuides)}
                size="icon"
                variant="ghost"
              >
                <img alt="Guides" className="h-[28px] w-[28px] object-contain" src="/icons/floorplan.png" />
              </ActionButton>
            )}

            {(canShowScans || canShowGuides) && <div className="mx-1 h-5 w-px bg-border/40" />}

            {/* Camera Mode */}
            <ActionButton
              label={`Camera: ${cameraMode === 'perspective' ? 'Perspective' : 'Orthographic'}`}
              tooltipSide="top"
              className={cameraMode === 'orthographic' ? 'bg-violet-500/20 text-violet-400' : 'hover:text-violet-400 hover:bg-white/5'}
              onClick={() => useViewer.getState().setCameraMode(cameraMode === 'perspective' ? 'orthographic' : 'perspective')}
              size="icon"
              variant="ghost"
            >
              <Camera className="h-6 w-6" />
            </ActionButton>

            {/* Level Mode */}
            <ActionButton
              label={`Levels: ${levelMode === 'manual' ? 'Manual' : levelModeLabels[levelMode as keyof typeof levelModeLabels]}`}
              tooltipSide="top"
              className={levelMode !== 'stacked' ? 'bg-amber-500/20 text-amber-400' : 'hover:text-amber-400 hover:bg-white/5'}
              onClick={() => {
                if (levelMode === 'manual') return useViewer.getState().setLevelMode('stacked')
                const modes: ('stacked' | 'exploded' | 'solo')[] = ['stacked', 'exploded', 'solo']
                const nextIndex = (modes.indexOf(levelMode as any) + 1) % modes.length
                useViewer.getState().setLevelMode(modes[nextIndex] ?? 'stacked')
              }}
              size="icon"
              variant="ghost"
            >
              {levelMode === 'solo' && <Diamond className="h-6 w-6" />}
              {levelMode === 'exploded' && <Layers2 className="h-6 w-6" />}
              {(levelMode === 'stacked' || levelMode === 'manual') && <Layers className="h-6 w-6" />}
            </ActionButton>

            {/* Wall Mode */}
            <ActionButton
              label={`Walls: ${wallModeConfig[wallMode as keyof typeof wallModeConfig].label}`}
              tooltipSide="top"
              className={wallMode !== 'cutaway' ? 'bg-white/10' : 'opacity-60 grayscale hover:opacity-100 hover:grayscale-0 hover:bg-white/5'}
              onClick={() => {
                const modes: ('cutaway' | 'up' | 'down')[] = ['cutaway', 'up', 'down']
                const nextIndex = (modes.indexOf(wallMode as any) + 1) % modes.length
                useViewer.getState().setWallMode(modes[nextIndex] ?? 'cutaway')
              }}
              size="icon"
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
              label="Orbit Left"
              tooltipSide="top"
              className="group hover:bg-white/5 hidden sm:inline-flex"
              onClick={() => emitter.emit('camera-controls:orbit-ccw')}
              size="icon"
              variant="ghost"
            >
              <img alt="Orbit Left" className="h-[28px] w-[28px] object-contain opacity-70 transition-opacity group-hover:opacity-100 -scale-x-100" src="/icons/rotate.png" />
            </ActionButton>

            <ActionButton
              label="Orbit Right"
              tooltipSide="top"
              className="group hover:bg-white/5 hidden sm:inline-flex"
              onClick={() => emitter.emit('camera-controls:orbit-cw')}
              size="icon"
              variant="ghost"
            >
              <img alt="Orbit Right" className="h-[28px] w-[28px] object-contain opacity-70 transition-opacity group-hover:opacity-100" src="/icons/rotate.png" />
            </ActionButton>

            <ActionButton
              label="Top View"
              tooltipSide="top"
              className="group hover:bg-white/5"
              onClick={() => emitter.emit('camera-controls:top-view')}
              size="icon"
              variant="ghost"
            >
              <img alt="Top View" className="h-[28px] w-[28px] object-contain opacity-70 transition-opacity group-hover:opacity-100" src="/icons/topview.png" />
            </ActionButton>
          </div>
        </TooltipProvider>
      </div>
    </>
  )
}

'use client'

import {
  type AnyNode,
  type AnyNodeId,
  type BuildingNode,
  getLevelDisplayName,
  type LevelNode,
  useScene,
  type ZoneNode,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { ArrowLeft, ChevronRight, Layers } from 'lucide-react'
import Link from 'next/link'
import type { ReactNode } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { cn } from '../../lib/utils'

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

export type ViewerSceneHeaderProps = {
  projectName?: string | null
  owner?: { username?: string | null } | null
  onBack?: () => void
  /** Fallback destination when no `onBack` handler is supplied. Must already be
   *  sanitized by the caller. */
  backHref?: string
  /** Extra row under the project info (e.g. likes/fork actions). */
  stats?: ReactNode
}

export const ViewerSceneHeader = ({
  projectName,
  owner,
  onBack,
  backHref = '/',
  stats,
}: ViewerSceneHeaderProps) => {
  const selection = useViewer((s) => s.selection)

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
  // Highest first so the list reads top-down like a building section.
  const levels = useScene(
    useShallow((s) => {
      if (!building) return []
      return building.children
        .map((id) => s.nodes[id as AnyNodeId] as LevelNode | undefined)
        .filter((n): n is LevelNode => n?.type === 'level')
        .sort((a, b) => b.level - a.level)
    }),
  )

  const handleLevelClick = (levelId: LevelNode['id']) => {
    // When switching levels, deselect zone and items
    useViewer.getState().setSelection({ levelId })
  }

  const handleBreadcrumbClick = (depth: 'root' | 'building' | 'level') => {
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
    <div className="dark absolute top-4 left-4 z-20 flex flex-col gap-3 text-foreground">
      <div className="corner-smooth pointer-events-auto flex min-w-[200px] flex-col overflow-hidden rounded-2xl border border-border/40 bg-background/95 shadow-elevation-4 backdrop-blur-xl transition-colors duration-200 ease-out">
        {/* Project info + back */}
        <div className="flex items-center gap-3 px-3 py-2.5">
          {onBack ? (
            <button
              aria-label="Back"
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition-colors hover:bg-white/10"
              onClick={onBack}
              type="button"
            >
              <ArrowLeft className="h-4 w-4 text-muted-foreground" />
            </button>
          ) : (
            <Link
              aria-label="Back"
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition-colors hover:bg-white/10"
              href={backHref}
              prefetch={false}
            >
              <ArrowLeft className="h-4 w-4 text-muted-foreground" />
            </Link>
          )}
          <div className="min-w-0 flex-1">
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

        {stats && (
          <div className="flex items-center gap-1 border-border/40 border-t px-3 py-2">{stats}</div>
        )}

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

              <ChevronRight className="h-3 w-3 text-muted-foreground/50" />
              <button
                className={`truncate transition-colors ${level ? 'text-muted-foreground hover:text-foreground' : 'font-medium text-foreground'}`}
                onClick={() => handleBreadcrumbClick('building')}
              >
                {building.name || 'Building'}
              </button>

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

      {/* Level list (only when a building is selected) */}
      {building && levels.length > 0 && (
        <div className="corner-smooth pointer-events-auto flex w-48 flex-col overflow-hidden rounded-2xl border border-border/40 bg-background/95 py-1 shadow-elevation-4 backdrop-blur-xl transition-colors duration-200 ease-out">
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
  )
}

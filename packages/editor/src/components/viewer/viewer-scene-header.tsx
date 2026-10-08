'use client'

import { getLevelDisplayName, type LevelNode, sceneRegistry, useScene } from '@pascal-app/core'
import { markPerfAction, useViewer } from '@pascal-app/viewer'
import { ArrowLeft, ChevronRight, Layers } from 'lucide-react'
import Link from 'next/link'
import { type ReactNode, useMemo } from 'react'
import { cn } from '../../lib/utils'
import {
  applyViewerClick,
  frameViewerNode,
  roomOfObject,
  selectViewerBuilding,
  selectViewerLevel,
  selectViewerRoom,
  selectViewerUnit,
  type ViewerCrumb,
  type ViewerSidebarSection,
  type ViewerSource,
  viewerBreadcrumb,
  viewerSidebarSections,
} from '../../lib/viewer-selection'
import { formatRoomArea } from '../editor/room-labels'

export type ViewerSceneHeaderProps = {
  projectName?: string | null
  owner?: { username?: string | null } | null
  onBack?: () => void
  /** Fallback destination when no `onBack` handler is supplied. Must already be
   *  sanitized by the caller. `null` shows no back arrow (an embedded viewer with
   *  nowhere to go back to). */
  backHref?: string | null
  /** Extra row under the project info (e.g. likes/fork actions). */
  stats?: ReactNode
  /** The scene the header navigates; the parametric scene store by default. */
  source?: ViewerSource
}

const SECTION_TITLES: Record<ViewerSidebarSection['kind'], string> = {
  units: 'Units',
  rooms: 'Rooms',
  zones: 'Zones',
}

const parametricObject = (id: string) => sceneRegistry.nodes.get(id)

/**
 * The navigation of every viewer surface: the project card, the bar (building
 * › floor › room › element) and the floor list with, under the current floor,
 * its units, rooms and zones. A row or a crumb selects and frames; the canvas
 * selects in place (`lib/viewer-selection.ts`).
 */
export const ViewerSceneHeader = ({
  projectName,
  owner,
  onBack,
  backHref = '/',
  stats,
  source: sourceProp,
}: ViewerSceneHeaderProps) => {
  const sceneNodes = useScene((s) => s.nodes)
  const source = useMemo<ViewerSource>(
    () => sourceProp ?? { nodes: sceneNodes, objectFor: parametricObject },
    [sourceProp, sceneNodes],
  )
  const { nodes } = source
  const selection = useViewer((s) => s.selection)
  const focusedUnitId = useViewer((s) => s.focusedUnitId)
  const unit = useViewer((s) => s.unit)

  const crumbs = useMemo(
    () =>
      viewerBreadcrumb(selection, focusedUnitId, nodes, (nodeId, levelId) =>
        roomOfObject(nodeId, levelId, source),
      ),
    [selection, focusedUnitId, nodes, source],
  )
  const buildingId = crumbs.find((crumb) => crumb.kind === 'building')?.id ?? null
  // Highest first so the list reads top-down like a building section.
  const levels = useMemo(() => {
    const building = buildingId ? nodes[buildingId] : undefined
    if (building?.type !== 'building') return []
    return building.children
      .map((id) => nodes[id])
      .filter((node): node is LevelNode => node?.type === 'level')
      .sort((a, b) => b.level - a.level)
  }, [buildingId, nodes])
  const sections = useMemo(
    () => (selection.levelId ? viewerSidebarSections(selection.levelId, nodes) : []),
    [selection.levelId, nodes],
  )

  const handleCrumb = (crumb: ViewerCrumb) => {
    switch (crumb.kind) {
      case 'building':
        return selectViewerBuilding(source)
      case 'level':
        return selectViewerLevel(crumb.id, source)
      case 'unit':
        return selectViewerUnit(crumb.id, source)
      case 'room':
        return selectViewerRoom(crumb.id, source)
      case 'node':
        applyViewerClick({ nodeId: crumb.id, point: null }, nodes)
        return frameViewerNode(crumb.id, source)
    }
  }

  return (
    <div className="dark absolute top-4 left-4 z-20 flex max-h-[calc(100%-7rem)] flex-col gap-3 text-foreground">
      <div className="corner-smooth pointer-events-auto flex min-w-[200px] max-w-[min(28rem,calc(100vw-2rem))] flex-col overflow-hidden rounded-2xl border border-border/40 bg-background/95 shadow-elevation-4 backdrop-blur-xl transition-colors duration-200 ease-out">
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
          ) : backHref === null ? null : (
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

        {crumbs.length > 0 && (
          <nav
            aria-label="Selection"
            className="flex flex-wrap items-center gap-x-1.5 gap-y-1 border-border/40 border-t px-3 py-2 text-xs"
            data-testid="viewer-breadcrumb"
          >
            {crumbs.map((crumb, index) => {
              const isLast = index === crumbs.length - 1
              return (
                <span
                  className="flex min-w-0 items-center gap-1.5"
                  key={`${crumb.kind}:${crumb.id}`}
                >
                  {index > 0 && <ChevronRight className="h-3 w-3 text-muted-foreground/50" />}
                  <button
                    className={cn(
                      'truncate transition-colors',
                      isLast
                        ? 'font-medium text-foreground'
                        : 'text-muted-foreground hover:text-foreground',
                    )}
                    data-crumb={crumb.kind}
                    onClick={() => handleCrumb(crumb)}
                    type="button"
                  >
                    {crumb.label}
                  </button>
                </span>
              )
            })}
          </nav>
        )}
      </div>

      {levels.length > 0 && (
        <div className="corner-smooth pointer-events-auto flex min-h-0 w-56 flex-col overflow-hidden rounded-2xl border border-border/40 bg-background/95 py-1 shadow-elevation-4 backdrop-blur-xl transition-colors duration-200 ease-out">
          <span className="px-3 py-2 font-medium text-[10px] text-muted-foreground uppercase tracking-wider">
            Levels
          </span>
          <div className="flex min-h-0 flex-col overflow-y-auto">
            {levels.map((lvl) => {
              const isSelected = lvl.id === selection.levelId
              return (
                <div key={lvl.id}>
                  <button
                    className={cn(
                      'group/row relative flex h-8 w-full cursor-pointer select-none items-center border-border/50 border-r border-r-transparent border-b px-3 text-sm transition-all duration-200',
                      isSelected
                        ? 'border-r-3 border-r-white bg-accent/50 text-foreground'
                        : 'text-muted-foreground hover:bg-accent/30 hover:text-foreground',
                    )}
                    onClick={() => {
                      if (!isSelected) markPerfAction('level-switch', lvl.id)
                      selectViewerLevel(lvl.id, source)
                    }}
                    type="button"
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
                  {isSelected &&
                    sections.map((section) => (
                      <div
                        className="border-border/50 border-b pb-1"
                        data-viewer-section={section.kind}
                        key={section.kind}
                      >
                        <span className="block px-3 pt-2 pb-1 pl-9 font-medium text-[10px] text-muted-foreground uppercase tracking-wider">
                          {SECTION_TITLES[section.kind]}
                        </span>
                        {section.rows.map((row) => {
                          const active =
                            section.kind === 'units'
                              ? row.id === focusedUnitId
                              : row.id === selection.zoneId
                          return (
                            <button
                              className={cn(
                                'flex h-7 w-full cursor-pointer select-none items-center gap-2 pr-3 pl-9 text-left text-sm transition-colors',
                                active
                                  ? 'bg-accent/50 text-foreground'
                                  : 'text-muted-foreground hover:bg-accent/30 hover:text-foreground',
                              )}
                              key={row.id}
                              onClick={() =>
                                section.kind === 'units'
                                  ? selectViewerUnit(row.id, source)
                                  : selectViewerRoom(row.id, source)
                              }
                              type="button"
                            >
                              <span
                                className="h-2 w-2 shrink-0 rounded-full"
                                style={{ backgroundColor: row.color }}
                              />
                              <span className="min-w-0 flex-1 truncate">{row.label}</span>
                              <span className="shrink-0 font-mono text-[11px] text-muted-foreground tabular-nums">
                                {formatRoomArea(row.areaM2, unit)}
                              </span>
                            </button>
                          )
                        })}
                      </div>
                    ))}
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

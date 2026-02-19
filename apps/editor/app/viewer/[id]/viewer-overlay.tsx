'use client'

import { type AnyNode, type AnyNodeId, type BuildingNode, type LevelNode, type ZoneNode, useScene } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import Link from 'next/link'
import { ArrowLeft, Box, ChevronRight, Diamond, Eye, EyeOff, Image, Layers, Layers2 } from 'lucide-react'
import type { ProjectOwner } from '@/features/community/lib/projects/types'

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
}

export const ViewerOverlay = ({ projectName, owner }: ViewerOverlayProps) => {
  const selection = useViewer((s) => s.selection)
  const nodes = useScene((s) => s.nodes)
  const showScans = useViewer((s) => s.showScans)
  const showGuides = useViewer((s) => s.showGuides)
  const cameraMode = useViewer((s) => s.cameraMode)
  const levelMode = useViewer((s) => s.levelMode)
  const wallMode = useViewer((s) => s.wallMode)

  const building = selection.buildingId ? (nodes[selection.buildingId] as BuildingNode | undefined) : null
  const level = selection.levelId ? (nodes[selection.levelId] as LevelNode | undefined) : null
  const zone = selection.zoneId ? (nodes[selection.zoneId] as ZoneNode | undefined) : null

  // Get the first selected item (if any)
  const selectedNode = selection.selectedIds.length > 0
    ? (nodes[selection.selectedIds[0] as AnyNodeId] as AnyNode | undefined)
    : null

  // Get all levels for the selected building
  const levels = building?.children
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
    <div className="absolute top-4 left-4 z-10 flex flex-col gap-3">
      <div className="bg-white/80 backdrop-blur-sm rounded-lg rounded-smooth shadow-[0_1px_4px_rgba(0,0,0,0.06),0_0_0_1px_rgba(0,0,0,0.03)] overflow-hidden">
        {/* Project info + back */}
        <div className="flex items-center gap-3 px-3 py-2">
          <Link
            href="/"
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md hover:bg-neutral-100 transition-colors"
          >
            <ArrowLeft className="h-4 w-4 text-neutral-500" />
          </Link>
          <div className="min-w-0">
            <div className="text-sm font-medium text-neutral-800 truncate">
              {projectName || 'Untitled'}
            </div>
            {owner?.username && (
              <Link
                href={`/u/${owner.username}`}
                className="text-xs text-neutral-500 hover:text-neutral-700 transition-colors"
              >
                @{owner.username}
              </Link>
            )}
          </div>
        </div>

        {/* Breadcrumb — only shown when navigated into a building */}
        {building && (
        <div className="border-t border-neutral-100 px-3 py-1.5">
          <div className="flex items-center gap-1 text-xs">
            <button
              onClick={() => handleBreadcrumbClick('root')}
              className="text-neutral-500 hover:text-neutral-800 transition-colors"
            >
              Site
            </button>

            {building && (
              <>
                <ChevronRight className="w-3 h-3 text-neutral-400" />
                <button
                  onClick={() => handleBreadcrumbClick('building')}
                  className={`transition-colors truncate ${level ? 'text-neutral-500 hover:text-neutral-800' : 'text-neutral-800 font-medium'}`}
                >
                  {building.name || 'Building'}
                </button>
              </>
            )}

            {level && (
              <>
                <ChevronRight className="w-3 h-3 text-neutral-400" />
                <button
                  onClick={() => handleBreadcrumbClick('level')}
                  className={`transition-colors truncate ${zone ? 'text-neutral-500 hover:text-neutral-800' : 'text-neutral-800 font-medium'}`}
                >
                  {level.name || `Level ${level.level}`}
                </button>
              </>
            )}

            {zone && (
              <>
                <ChevronRight className="w-3 h-3 text-neutral-400" />
                <span className={`transition-colors truncate ${selectedNode ? 'text-neutral-500' : 'text-neutral-800 font-medium'}`}>
                  {zone.name}
                </span>
              </>
            )}

            {selectedNode && zone && (
              <>
                <ChevronRight className="w-3 h-3 text-neutral-400" />
                <span className="text-neutral-800 font-medium truncate">{getNodeName(selectedNode)}</span>
              </>
            )}
          </div>
        </div>
        )}
      </div>

      {/* Level List (only when building is selected) */}
      {building && levels.length > 0 && (
        <div className="flex flex-col gap-1 bg-white/80 backdrop-blur-sm rounded-lg p-2 shadow-[0_1px_4px_rgba(0,0,0,0.06),0_0_0_1px_rgba(0,0,0,0.03)] w-40">
          <span className="text-xs text-neutral-500 px-2 pb-1">Levels</span>
          {levels.map((lvl) => (
            <button
              key={lvl.id}
              onClick={() => handleLevelClick(lvl.id)}
              className={`text-left px-2 py-1 rounded text-sm transition-colors ${
                lvl.id === selection.levelId
                  ? 'bg-blue-500 text-white'
                  : 'text-neutral-700 hover:bg-neutral-100'
              }`}
            >
              {lvl.name || `Level ${lvl.level}`}
            </button>
          ))}
        </div>
      )}
    </div>

    {/* Controls Panel - Top Right */}
    <div className="absolute top-4 right-4 z-10 flex flex-col gap-2">
      {/* Visibility Controls */}
      <div className="flex flex-col gap-1 bg-white/80 backdrop-blur-sm rounded-lg p-2 shadow-[0_1px_4px_rgba(0,0,0,0.06),0_0_0_1px_rgba(0,0,0,0.03)]">
        <span className="text-xs text-neutral-500 px-2 pb-1">Visibility</span>
        <button
          onClick={() => useViewer.getState().setShowScans(!showScans)}
          className={`flex items-center gap-2 px-2 py-1 rounded text-sm transition-colors ${
            showScans ? 'bg-blue-500 text-white' : 'text-neutral-700 hover:bg-neutral-100'
          }`}
        >
          <Box className="w-4 h-4" />
          3D Scans
        </button>
        <button
          onClick={() => useViewer.getState().setShowGuides(!showGuides)}
          className={`flex items-center gap-2 px-2 py-1 rounded text-sm transition-colors ${
            showGuides ? 'bg-blue-500 text-white' : 'text-neutral-700 hover:bg-neutral-100'
          }`}
        >
          <Image className="w-4 h-4" />
          Guides
        </button>
      </div>

      {/* Camera Mode */}
      <div className="flex flex-col gap-1 bg-white/80 backdrop-blur-sm rounded-lg p-2 shadow-[0_1px_4px_rgba(0,0,0,0.06),0_0_0_1px_rgba(0,0,0,0.03)]">
        <span className="text-xs text-neutral-500 px-2 pb-1">Camera</span>
        <button
          onClick={() => useViewer.getState().setCameraMode(cameraMode === 'perspective' ? 'orthographic' : 'perspective')}
          className="flex items-center gap-2 px-2 py-1 rounded text-sm text-neutral-700 hover:bg-neutral-100 transition-colors"
        >
          {cameraMode === 'perspective' ? (
            <Eye className="w-4 h-4" />
          ) : (
            <EyeOff className="w-4 h-4" />
          )}
          {cameraMode === 'perspective' ? 'Perspective' : 'Orthographic'}
        </button>
      </div>

      {/* Level Mode */}
      <div className="flex flex-col gap-1 bg-white/80 backdrop-blur-sm rounded-lg p-2 shadow-[0_1px_4px_rgba(0,0,0,0.06),0_0_0_1px_rgba(0,0,0,0.03)]">
        <span className="text-xs text-neutral-500 px-2 pb-1">Level Mode</span>
        <button
          onClick={() => useViewer.getState().setLevelMode('stacked')}
          className={`flex items-center gap-2 px-2 py-1 rounded text-sm transition-colors ${
            levelMode === 'stacked' ? 'bg-blue-500 text-white' : 'text-neutral-700 hover:bg-neutral-100'
          }`}
        >
          <Layers className="w-4 h-4" />
          Stacked
        </button>
        <button
          onClick={() => useViewer.getState().setLevelMode('exploded')}
          className={`flex items-center gap-2 px-2 py-1 rounded text-sm transition-colors ${
            levelMode === 'exploded' ? 'bg-blue-500 text-white' : 'text-neutral-700 hover:bg-neutral-100'
          }`}
        >
          <Layers2 className="w-4 h-4" />
          Exploded
        </button>
        <button
          onClick={() => useViewer.getState().setLevelMode('solo')}
          className={`flex items-center gap-2 px-2 py-1 rounded text-sm transition-colors ${
            levelMode === 'solo' ? 'bg-blue-500 text-white' : 'text-neutral-700 hover:bg-neutral-100'
          }`}
        >
          <Diamond className="w-4 h-4" />
          Solo
        </button>
      </div>

      {/* Wall Mode */}
      <div className="flex flex-col gap-1 bg-white/80 backdrop-blur-sm rounded-lg p-2 shadow-[0_1px_4px_rgba(0,0,0,0.06),0_0_0_1px_rgba(0,0,0,0.03)]">
        <span className="text-xs text-neutral-500 px-2 pb-1">Wall Mode</span>
        <button
          onClick={() => useViewer.getState().setWallMode('cutaway')}
          className={`flex items-center gap-2 px-2 py-1 rounded text-sm transition-colors ${
            wallMode === 'cutaway' ? 'bg-blue-500 text-white' : 'text-neutral-700 hover:bg-neutral-100'
          }`}
        >
          <img alt="Cutaway" height={16} src="/icons/wallcut.png" width={16} className="w-4 h-4" />
          Cutaway
        </button>
        <button
          onClick={() => useViewer.getState().setWallMode('up')}
          className={`flex items-center gap-2 px-2 py-1 rounded text-sm transition-colors ${
            wallMode === 'up' ? 'bg-blue-500 text-white' : 'text-neutral-700 hover:bg-neutral-100'
          }`}
        >
          <img alt="Full Height" height={16} src="/icons/room.png" width={16} className="w-4 h-4" />
          Full Height
        </button>
        <button
          onClick={() => useViewer.getState().setWallMode('down')}
          className={`flex items-center gap-2 px-2 py-1 rounded text-sm transition-colors ${
            wallMode === 'down' ? 'bg-blue-500 text-white' : 'text-neutral-700 hover:bg-neutral-100'
          }`}
        >
          <img alt="Low" height={16} src="/icons/walllow.png" width={16} className="w-4 h-4" />
          Low
        </button>
      </div>
    </div>
    </>
  )
}

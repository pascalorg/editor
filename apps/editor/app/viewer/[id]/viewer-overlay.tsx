'use client'

import { type AnyNode, type BuildingNode, type LevelNode, type ZoneNode, useScene } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { Box, ChevronRight, Diamond, Eye, EyeOff, Image, Layers, Layers2 } from 'lucide-react'

const getNodeName = (node: AnyNode): string => {
  if ('name' in node && node.name) return node.name
  if (node.type === 'wall') return 'Wall'
  if (node.type === 'item') return (node as { asset: { name: string } }).asset?.name || 'Item'
  if (node.type === 'slab') return 'Slab'
  if (node.type === 'ceiling') return 'Ceiling'
  if (node.type === 'roof') return 'Roof'
  return node.type
}

export const ViewerOverlay = () => {
  const selection = useViewer((s) => s.selection)
  const nodes = useScene((s) => s.nodes)
  const showScans = useViewer((s) => s.showScans)
  const showGuides = useViewer((s) => s.showGuides)
  const cameraMode = useViewer((s) => s.cameraMode)
  const levelMode = useViewer((s) => s.levelMode)

  const building = selection.buildingId ? (nodes[selection.buildingId] as BuildingNode | undefined) : null
  const level = selection.levelId ? (nodes[selection.levelId] as LevelNode | undefined) : null
  const zone = selection.zoneId ? (nodes[selection.zoneId] as ZoneNode | undefined) : null

  // Get the first selected item (if any)
  const selectedNode = selection.selectedIds.length > 0
    ? (nodes[selection.selectedIds[0]!] as AnyNode | undefined)
    : null

  // Get all levels for the selected building
  const levels = building?.children
    .map((id) => nodes[id] as LevelNode | undefined)
    .filter((n): n is LevelNode => n?.type === 'level')
    .sort((a, b) => a.level - b.level) ?? []

  const handleLevelClick = (levelId: string) => {
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
    <div className="absolute top-4 left-4 z-10 flex flex-col gap-3">
      {/* Breadcrumb */}
      <div className="flex items-center gap-1 text-sm">
        <button
          onClick={() => handleBreadcrumbClick('root')}
          className="text-neutral-500 hover:text-neutral-800 transition-colors"
        >
          Site
        </button>

        {building && (
          <>
            <ChevronRight className="w-4 h-4 text-neutral-400" />
            <button
              onClick={() => handleBreadcrumbClick('building')}
              className={`transition-colors ${level ? 'text-neutral-500 hover:text-neutral-800' : 'text-neutral-800 font-medium'}`}
            >
              {building.name || 'Building'}
            </button>
          </>
        )}

        {level && (
          <>
            <ChevronRight className="w-4 h-4 text-neutral-400" />
            <button
              onClick={() => handleBreadcrumbClick('level')}
              className={`transition-colors ${zone ? 'text-neutral-500 hover:text-neutral-800' : 'text-neutral-800 font-medium'}`}
            >
              {level.name || `Level ${level.level}`}
            </button>
          </>
        )}

        {zone && (
          <>
            <ChevronRight className="w-4 h-4 text-neutral-400" />
            <span className={`transition-colors ${selectedNode ? 'text-neutral-500' : 'text-neutral-800 font-medium'}`}>
              {zone.name}
            </span>
          </>
        )}

        {selectedNode && zone && (
          <>
            <ChevronRight className="w-4 h-4 text-neutral-400" />
            <span className="text-neutral-800 font-medium">{getNodeName(selectedNode)}</span>
          </>
        )}
      </div>

      {/* Level List (only when building is selected) */}
      {building && levels.length > 0 && (
        <div className="flex flex-col gap-1 bg-white/80 backdrop-blur-sm rounded-lg p-2 shadow-sm border border-neutral-200 w-40">
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
      <div className="flex flex-col gap-1 bg-white/80 backdrop-blur-sm rounded-lg p-2 shadow-sm border border-neutral-200">
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
      <div className="flex flex-col gap-1 bg-white/80 backdrop-blur-sm rounded-lg p-2 shadow-sm border border-neutral-200">
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
      <div className="flex flex-col gap-1 bg-white/80 backdrop-blur-sm rounded-lg p-2 shadow-sm border border-neutral-200">
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
    </div>
    </>
  )
}

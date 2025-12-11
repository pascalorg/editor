'use client'

import { Building, ChevronDown, ChevronRight, Eye, EyeOff, Grid2x2, Layers } from 'lucide-react'
import { useCallback, useState } from 'react'
import { useShallow } from 'zustand/shallow'
import { Button } from '@/components/ui/button'
import { type StoreState, useEditor } from '@/hooks/use-editor'
import type { Collection } from '@/lib/scenegraph/schema/collections'
import { cn } from '@/lib/utils'

interface ViewerLayersMenuProps {
  mounted: boolean
}

const EMPTY_LEVELS: any[] = []

export function ViewerLayersMenu({ mounted }: ViewerLayersMenuProps) {
  const building = useEditor((state) =>
    state.scene.root.children?.[0]?.children.find((c) => c.type === 'building'),
  )

  const levels = useEditor((state) => {
    const building = state.scene.root.children?.[0]?.children.find((c) => c.type === 'building')
    return building ? building.children : EMPTY_LEVELS
  })

  // Get room collections grouped by levelId
  const roomCollections = useEditor(
    useShallow((state: StoreState) =>
      (state.scene.collections || []).filter((c) => c.type === 'room'),
    ),
  )

  const selectedFloorId = useEditor((state) => state.selectedFloorId)
  const selectedNodeIds = useEditor((state) => state.selectedNodeIds)
  const selectedCollectionId = useEditor((state) => state.selectedCollectionId)
  const selectFloor = useEditor((state) => state.selectFloor)
  const selectCollection = useEditor((state) => state.selectCollection)
  const toggleNodeVisibility = useEditor((state) => state.toggleNodeVisibility)
  const selectNode = useEditor((state) => state.selectNode)
  const levelMode = useEditor((state) => state.levelMode)

  const isBuildingSelected = building 
    ? (selectedNodeIds.includes(building.id) || !!selectedFloorId || levelMode === 'exploded') 
    : false

  // Track expanded levels
  const [expandedLevels, setExpandedLevels] = useState<Set<string>>(new Set())

  // Get sorted floor levels for rendering (highest level first)
  const floorGroups = levels
    .filter((level) => level.type === 'level')
    .sort((a, b) => (b.level || 0) - (a.level || 0))

  // Group room collections by levelId
  const roomsByLevel = roomCollections.reduce<Record<string, Collection[]>>((acc, collection) => {
    const levelId = collection.levelId || 'unassigned'
    if (!acc[levelId]) acc[levelId] = []
    acc[levelId].push(collection)
    return acc
  }, {})

  const handleBuildingClick = useCallback(() => {
    if (!building) return

    if (isBuildingSelected) {
      // Deselect building
      useEditor.setState({
        selectedNodeIds: [],
        levelMode: 'stacked',
        // Also clear floor/collection selection when deselecting building
        selectedFloorId: null,
        selectedCollectionId: null,
        viewMode: 'full',
      })
    } else {
      // Select building
      useEditor.setState({
        selectedNodeIds: [building.id],
        levelMode: 'exploded',
        // Ensure we're in full view mode initially
        viewMode: 'full',
      })
    }
  }, [building, isBuildingSelected])

  const handleFloorClick = (floorId: string) => {
    if (!isBuildingSelected) return

    // Clear collection selection when clicking a floor
    if (selectedCollectionId) {
      selectCollection(null)
    }
    if (selectedFloorId === floorId) {
      // Deselect if clicking the same floor - Go back to Building selection
      useEditor.setState({
        selectedFloorId: null,
        selectedNodeIds: [building.id],
        viewMode: 'full',
      })
    } else {
      selectFloor(floorId)
    }
  }

  const toggleLevelExpansion = (levelId: string, e: React.MouseEvent) => {
    e.stopPropagation()
    if (!isBuildingSelected) return
    
    setExpandedLevels((prev) => {
      const next = new Set(prev)
      if (next.has(levelId)) {
        next.delete(levelId)
      } else {
        next.add(levelId)
      }
      return next
    })
  }

  const handleRoomClick = (collection: Collection, levelId: string, e: React.MouseEvent) => {
    e.stopPropagation()
    if (!isBuildingSelected) return

    // Select the level if not already selected
    if (selectedFloorId !== levelId) {
      selectFloor(levelId)
    }
    // Use selectCollection to focus on the room
    selectCollection(collection.id)
  }

  // Check if this room collection is currently selected
  const isRoomSelected = (collection: Collection): boolean => selectedCollectionId === collection.id

  if (!mounted || !building) return <div className="p-3 text-white/50 text-xs italic">Loading...</div>

  return (
    <div className="w-52 min-w-52">
      <div className="space-y-0.5 p-2">
        {/* Building Node */}
        <div
          className={cn(
            'group flex cursor-pointer items-center gap-1.5 rounded-md px-2 py-1.5 transition-all',
            'hover:bg-white/10',
            isBuildingSelected && 'bg-white/15',
          )}
          onClick={handleBuildingClick}
        >
          <div className="w-4 shrink-0" />
          <Building className="h-3.5 w-3.5 shrink-0 text-blue-400" />
          <span className="flex-1 text-sm text-white">Building</span>
        </div>

        {/* Levels List - Indented and Conditional */}
        <div className={cn('pl-2 transition-opacity duration-200', !isBuildingSelected && 'opacity-30 pointer-events-none')}>
          {floorGroups.map((level) => {
            const isSelected = selectedFloorId === level.id
            const isVisible = level.visible !== false
            const levelRooms = roomsByLevel[level.id] || []
            const hasRooms = levelRooms.length > 0
            const isExpanded = expandedLevels.has(level.id)

            return (
              <div key={level.id}>
                {/* Level row */}
                <div
                  className={cn(
                    'group flex cursor-pointer items-center gap-1.5 rounded-md px-2 py-1.5 transition-all',
                    'hover:bg-white/10',
                    isSelected && 'bg-white/15',
                    !isVisible && 'opacity-40',
                  )}
                  onClick={() => handleFloorClick(level.id)}
                >
                  {/* Expand/collapse button for levels with rooms */}
                  {hasRooms ? (
                    <button
                      className="flex h-4 w-4 shrink-0 items-center justify-center text-white/60 hover:text-white"
                      onClick={(e) => toggleLevelExpansion(level.id, e)}
                      type="button"
                    >
                      {isExpanded ? (
                        <ChevronDown className="h-3.5 w-3.5" />
                      ) : (
                        <ChevronRight className="h-3.5 w-3.5" />
                      )}
                    </button>
                  ) : (
                    <div className="w-4 shrink-0" />
                  )}
                  <Layers className="h-3.5 w-3.5 shrink-0 text-blue-400" />
                  <span className="flex-1 text-sm text-white">{level.name}</span>
                  {hasRooms && <span className="text-white/40 text-xs">{levelRooms.length}</span>}
                  <Button
                    className={cn(
                      'h-5 w-5 p-0 text-white transition-opacity hover:bg-white/20',
                      isVisible ? 'opacity-0 group-hover:opacity-70' : 'opacity-70',
                    )}
                    onClick={(e) => {
                      e.stopPropagation()
                      toggleNodeVisibility(level.id)
                    }}
                    size="sm"
                    variant="ghost"
                  >
                    {isVisible ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
                  </Button>
                </div>

                {/* Room collections for this level */}
                {hasRooms && isExpanded && (
                  <div className="mt-0.5 ml-4 space-y-0.5 border-white/10 border-l pl-2">
                    {levelRooms.map((room) => {
                      const roomSelected = isRoomSelected(room)
                      return (
                        <div
                          className={cn(
                            'group flex cursor-pointer items-center gap-2 rounded-md px-2 py-1 transition-all',
                            'hover:bg-white/10',
                            roomSelected && 'bg-amber-500/20',
                          )}
                          key={room.id}
                          onClick={(e) => handleRoomClick(room, level.id, e)}
                        >
                          <Grid2x2 className="h-3 w-3 shrink-0 text-amber-400" />
                          <span className="flex-1 text-white/90 text-xs">{room.name}</span>
                          {room.nodeIds.length > 0 && (
                            <span className="text-white/40 text-xs">{room.nodeIds.length}</span>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

'use client'

import { Eye, EyeOff, Layers } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useEditor } from '@/hooks/use-editor'
import { cn } from '@/lib/utils'

interface ViewerLayersMenuProps {
  mounted: boolean
}

export function ViewerLayersMenu({ mounted }: ViewerLayersMenuProps) {
  const levels = useEditor((state) => { const building = state.root.children[0]; return building ? building.children : [] })
  const selectedFloorId = useEditor((state) => state.selectedFloorId)
  const selectFloor = useEditor((state) => state.selectFloor)
  const toggleFloorVisibility = useEditor((state) => state.toggleFloorVisibility)

  // Get sorted floor levels for rendering (highest level first)
  const floorGroups = levels
    .filter((level) => level.type === 'level')
    .sort((a, b) => (b.level || 0) - (a.level || 0))

  const handleFloorClick = (floorId: string) => {
    if (selectedFloorId === floorId) {
      // Deselect if clicking the same floor
      selectFloor(null)
    } else {
      selectFloor(floorId)
    }
  }

  return (
    <div className="w-48 min-w-48">
      {mounted ? (
        <div className="space-y-0.5 p-2">
          {floorGroups.map((level) => {
            const isSelected = selectedFloorId === level.id
            const isVisible = level.visible !== false

            return (
              <div
                className={cn(
                  'group flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 transition-all',
                  'hover:bg-white/10',
                  isSelected && 'bg-white/15',
                  !isVisible && 'opacity-40',
                )}
                key={level.id}
                onClick={() => handleFloorClick(level.id)}
              >
                <Layers className="h-3.5 w-3.5 shrink-0 text-blue-400" />
                <span className="flex-1 text-sm text-white">{level.name}</span>
                <Button
                  className={cn(
                    'h-5 w-5 p-0 text-white transition-opacity hover:bg-white/20',
                    isVisible ? 'opacity-0 group-hover:opacity-70' : 'opacity-70',
                  )}
                  onClick={(e) => {
                    e.stopPropagation()
                    toggleFloorVisibility(level.id)
                  }}
                  size="sm"
                  variant="ghost"
                >
                  {isVisible ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
                </Button>
              </div>
            )
          })}
        </div>
      ) : (
        <div className="p-3 text-white/50 text-xs italic">Loading...</div>
      )}
    </div>
  )
}

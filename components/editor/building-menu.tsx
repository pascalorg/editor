'use client'

import Image from 'next/image'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { type Tool, useEditor } from '@/hooks/use-editor'
import { cn } from '@/lib/utils'

export function BuildingMenu() {
  const activeTool = useEditor((state) => state.activeTool)
  const setActiveTool = useEditor((state) => state.setActiveTool)
  const controlMode = useEditor((state) => state.controlMode)

  const tools: Array<{ id: Tool; iconSrc: string; label: string; enabled: boolean }> = [
    { id: 'slab', iconSrc: '/icons/floor.png', label: 'Slab', enabled: true },
    { id: 'ceiling', iconSrc: '/icons/ceiling.png', label: 'Ceiling', enabled: true },
    { id: 'wall', iconSrc: '/icons/wall.png', label: 'Wall', enabled: true },
    { id: 'room', iconSrc: '/icons/room.png', label: 'Room', enabled: true },
    { id: 'custom-room', iconSrc: '/icons/custom-room.png', label: 'Custom Room', enabled: true },
    { id: 'roof', iconSrc: '/icons/roof.png', label: 'Gable Roof', enabled: true },
    { id: 'door', iconSrc: '/icons/door.png', label: 'Door', enabled: true },
    { id: 'window', iconSrc: '/icons/window.png', label: 'Window', enabled: true },
    { id: 'column', iconSrc: '/icons/column.png', label: 'Column', enabled: true },
    { id: 'item', iconSrc: '/icons/couch.png', label: 'Item', enabled: true },
    { id: 'stair', iconSrc: '/icons/stairs.png', label: 'Stair', enabled: true },
  ]

  return (
    <TooltipProvider>
      <div
        className={cn(
          '-translate-x-1/2 fixed bottom-8 left-1/2 z-50 flex items-center gap-2',
          'rounded-2xl border border-zinc-800 bg-zinc-950/90 shadow-2xl backdrop-blur-md',
          'p-2',
          controlMode !== 'building' && 'cursor-not-allowed',
        )}
      >
        {tools.map((tool) => {
          // Only show as active if the tool is selected AND we're in building mode
          const isActive = activeTool === tool.id && controlMode === 'building'

          return (
            <Tooltip key={tool.id}>
              <TooltipTrigger asChild>
                <Button
                  className={cn(
                    'size-14 rounded-xl transition-all',
                    isActive && tool.enabled && 'bg-primary shadow-lg shadow-primary/20',
                    !isActive && tool.enabled && 'hover:bg-white/10',
                    controlMode !== 'building' && activeTool !== tool.id && 'opacity-50',
                  )}
                  disabled={!tool.enabled}
                  onClick={() => {
                    // If clicking the currently active tool in building mode, deselect it
                    if (activeTool === tool.id && controlMode === 'building') {
                      setActiveTool(null)
                    } else if (tool.enabled) {
                      // Otherwise, select this tool (which automatically switches to building mode)
                      setActiveTool(tool.id)
                    } else {
                      // Otherwise, do nothing
                      return
                    }
                  }}
                  size="icon"
                  variant={isActive && tool.enabled ? 'default' : 'ghost'}
                >
                  <Image
                    alt={tool.label}
                    className="size-full object-contain"
                    height={40}
                    src={tool.iconSrc}
                    width={40}
                  />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>
                  {tool.label}
                  {isActive && ' (Click to deselect)'}
                  {controlMode !== 'building' &&
                    activeTool !== tool.id &&
                    ' (Click to switch to building mode)'}
                </p>
              </TooltipContent>
            </Tooltip>
          )
        })}
      </div>
    </TooltipProvider>
  )
}

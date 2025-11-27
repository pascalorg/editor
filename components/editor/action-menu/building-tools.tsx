'use client'

import NextImage from 'next/image'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { type Tool, useEditor } from '@/hooks/use-editor'
import { cn } from '@/lib/utils'

const tools: Array<{ id: Tool; iconSrc: string; label: string }> = [
  { id: 'slab', iconSrc: '/icons/floor.png', label: 'Slab' },
  { id: 'ceiling', iconSrc: '/icons/ceiling.png', label: 'Ceiling' },
  { id: 'wall', iconSrc: '/icons/wall.png', label: 'Wall' },
  { id: 'room', iconSrc: '/icons/room.png', label: 'Room' },
  { id: 'custom-room', iconSrc: '/icons/custom-room.png', label: 'Custom Room' },
  { id: 'roof', iconSrc: '/icons/roof.png', label: 'Gable Roof' },
  { id: 'door', iconSrc: '/icons/door.png', label: 'Door' },
  { id: 'window', iconSrc: '/icons/window.png', label: 'Window' },
  { id: 'column', iconSrc: '/icons/column.png', label: 'Column' },
  { id: 'item', iconSrc: '/icons/couch.png', label: 'Item' },
  { id: 'stair', iconSrc: '/icons/stairs.png', label: 'Stair' },
]

export function BuildingTools() {
  const controlMode = useEditor((state) => state.controlMode)
  const activeTool = useEditor((state) => state.activeTool)
  const setActiveTool = useEditor((state) => state.setActiveTool)

  return (
    <div className="flex items-center gap-1.5">
      {tools.map((tool) => {
        const isActive = activeTool === tool.id && controlMode === 'building'

        return (
          <Tooltip key={tool.id}>
            <TooltipTrigger asChild>
              <Button
                className={cn(
                  'size-11 rounded-lg transition-all',
                  isActive && 'bg-primary shadow-md shadow-primary/20',
                  !isActive && 'hover:bg-white/10',
                )}
                onClick={() => {
                  if (activeTool === tool.id && controlMode === 'building') {
                    setActiveTool(null)
                  } else {
                    setActiveTool(tool.id)
                  }
                }}
                size="icon"
                variant={isActive ? 'default' : 'ghost'}
              >
                <NextImage
                  alt={tool.label}
                  className="size-full object-contain"
                  height={28}
                  src={tool.iconSrc}
                  width={28}
                />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <p>
                {tool.label}
                {isActive && ' (Click to deselect)'}
              </p>
            </TooltipContent>
          </Tooltip>
        )
      })}
    </div>
  )
}


'use client'

import NextImage from 'next/image'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { type CatalogCategory, type Tool, useEditor } from '@/hooks/use-editor'
import { cn } from '@/lib/utils'

type ToolConfig =
  | { id: Tool; iconSrc: string; label: string; catalogCategory?: never }
  | { id: 'item'; iconSrc: string; label: string; catalogCategory: CatalogCategory }

const tools: ToolConfig[] = [
  { id: 'wall', iconSrc: '/icons/wall.png', label: 'Wall' },
  { id: 'room', iconSrc: '/icons/room.png', label: 'Room' },
  { id: 'custom-room', iconSrc: '/icons/custom-room.png', label: 'Custom Room' },
  { id: 'slab', iconSrc: '/icons/floor.png', label: 'Slab' },
  { id: 'ceiling', iconSrc: '/icons/ceiling.png', label: 'Ceiling' },
  { id: 'roof', iconSrc: '/icons/roof.png', label: 'Gable Roof' },
  { id: 'column', iconSrc: '/icons/column.png', label: 'Column' },
  { id: 'item', iconSrc: '/icons/door.png', label: 'Door', catalogCategory: 'door' },
  { id: 'item', iconSrc: '/icons/window.png', label: 'Window', catalogCategory: 'window' },
  { id: 'item', iconSrc: '/icons/couch.png', label: 'Furniture', catalogCategory: 'furniture' },
  { id: 'item', iconSrc: '/icons/appliance.png', label: 'Appliance', catalogCategory: 'appliance' },
  { id: 'item', iconSrc: '/icons/kitchen.png', label: 'Kitchen', catalogCategory: 'kitchen' },
  { id: 'item', iconSrc: '/icons/bathroom.png', label: 'Bathroom', catalogCategory: 'bathroom' },
  { id: 'item', iconSrc: '/icons/outdoor.png', label: 'Outdoor', catalogCategory: 'outdoor' },
  { id: 'stair', iconSrc: '/icons/stairs.png', label: 'Stair' },
]

export function BuildingTools() {
  const controlMode = useEditor((state) => state.controlMode)
  const activeTool = useEditor((state) => state.activeTool)
  const catalogCategory = useEditor((state) => state.catalogCategory)
  const setActiveTool = useEditor((state) => state.setActiveTool)

  return (
    <div className="flex items-center gap-1.5">
      {tools.map((tool, index) => {
        // For item tools with catalog category, check both tool and category match
        const isActive =
          controlMode === 'building' &&
          activeTool === tool.id &&
          (tool.catalogCategory ? catalogCategory === tool.catalogCategory : true)

        return (
          <Tooltip key={`${tool.id}-${tool.catalogCategory ?? index}`}>
            <TooltipTrigger asChild>
              <Button
                className={cn(
                  'size-11 rounded-lg transition-all',
                  isActive && 'bg-primary shadow-md shadow-primary/20',
                  !isActive && 'hover:bg-white/10',
                )}
                onClick={() => {
                  if (isActive) {
                    setActiveTool(null)
                  } else {
                    setActiveTool(tool.id, tool.catalogCategory ?? null)
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

'use client'

import NextImage from 'next/image'
import { Button } from '@/components/ui/primitives/button'
import { Tooltip, TooltipContent, TooltipTrigger, } from '@/components/ui/primitives/tooltip'

import { cn } from '@/lib/utils'
import useEditor, { CatalogCategory, StructureTool, Tool } from '@/store/use-editor'

export type ToolConfig = {
   id: StructureTool; iconSrc: string; label: string; catalogCategory?: CatalogCategory }

export const tools: ToolConfig[] = [
  { id: 'wall', iconSrc: '/icons/wall.png', label: 'Wall' },
  // { id: 'room', iconSrc: '/icons/room.png', label: 'Room' },
  // { id: 'custom-room', iconSrc: '/icons/custom-room.png', label: 'Custom Room' },
  { id: 'slab', iconSrc: '/icons/floor.png', label: 'Slab' },
  { id: 'ceiling', iconSrc: '/icons/ceiling.png', label: 'Ceiling' },
  { id: 'roof', iconSrc: '/icons/roof.png', label: 'Gable Roof' },
  { id: 'item', iconSrc: '/icons/door.png', label: 'Door', catalogCategory: 'door' },
  { id: 'window', iconSrc: '/icons/window.png', label: 'Window' },
  { id: 'zone', iconSrc: '/icons/zone.png', label: 'Zone' },
]

export function StructureTools() {
  const activeTool = useEditor((state) => state.tool)
  const catalogCategory = useEditor((state) => state.catalogCategory)
  const structureLayer = useEditor((state) => state.structureLayer)
  const setTool   = useEditor((state) => state.setTool)
  const setCatalogCategory = useEditor((state) => state.setCatalogCategory)

  // Filter tools based on structureLayer
  const visibleTools = structureLayer === 'zones'
    ? tools.filter((t) => t.id === 'zone')
    : tools.filter((t) => t.id !== 'zone')

  return (
    <div className="flex items-center gap-1.5">
      {visibleTools.map((tool, index) => {
        // For item tools with catalog category, check both tool and category match
        const isActive =
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
                    setTool(null)
                    setCatalogCategory(null)
                  } else {
                    setTool(tool.id)
                    setCatalogCategory(tool.catalogCategory ?? null)
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

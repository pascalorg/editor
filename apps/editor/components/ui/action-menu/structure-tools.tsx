'use client'

import NextImage from 'next/image'
import { Button } from '@/components/ui/primitives/button'
import { Tooltip, TooltipContent, TooltipTrigger, } from '@/components/ui/primitives/tooltip'

import { cn } from '@/lib/utils'
import useEditor, { CatalogCategory, StructureTool, Tool } from '@/store/use-editor'
import { useContextualTools } from '@/hooks/use-contextual-tools'

export type ToolConfig = {
   id: StructureTool; iconSrc: string; label: string; catalogCategory?: CatalogCategory }

export const tools: ToolConfig[] = [
  { id: 'wall', iconSrc: '/icons/wall.png', label: 'Wall' },
  // { id: 'room', iconSrc: '/icons/room.png', label: 'Room' },
  // { id: 'custom-room', iconSrc: '/icons/custom-room.png', label: 'Custom Room' },
  { id: 'slab', iconSrc: '/icons/floor.png', label: 'Slab' },
  { id: 'ceiling', iconSrc: '/icons/ceiling.png', label: 'Ceiling' },
  { id: 'roof', iconSrc: '/icons/roof.png', label: 'Gable Roof' },
  { id: 'door', iconSrc: '/icons/door.png', label: 'Door' },
  { id: 'window', iconSrc: '/icons/window.png', label: 'Window' },
  { id: 'zone', iconSrc: '/icons/zone.png', label: 'Zone' },
]

export function StructureTools() {
  const activeTool = useEditor((state) => state.tool)
  const catalogCategory = useEditor((state) => state.catalogCategory)
  const structureLayer = useEditor((state) => state.structureLayer)
  const setTool   = useEditor((state) => state.setTool)
  const setCatalogCategory = useEditor((state) => state.setCatalogCategory)
  
  const contextualTools = useContextualTools()

  // Filter tools based on structureLayer
  const visibleTools = structureLayer === 'zones'
    ? tools.filter((t) => t.id === 'zone')
    : tools.filter((t) => t.id !== 'zone')

  const hasActiveTool = visibleTools.some((t) => 
    activeTool === t.id && 
    (t.catalogCategory ? catalogCategory === t.catalogCategory : true)
  )

  return (
    <div className="flex items-center gap-1.5 px-1">
      {visibleTools.map((tool, index) => {
        // For item tools with catalog category, check both tool and category match
        const isActive =
          activeTool === tool.id &&
          (tool.catalogCategory ? catalogCategory === tool.catalogCategory : true)
          
        const isContextual = contextualTools.includes(tool.id)

        return (
          <Tooltip key={`${tool.id}-${tool.catalogCategory ?? index}`}>
            <TooltipTrigger asChild>
              <Button
                className={cn(
                  'size-11 rounded-lg transition-all duration-300',
                  isActive && 'bg-primary shadow-lg shadow-primary/40 ring-2 ring-primary ring-offset-2 ring-offset-zinc-950 scale-110 z-10',
                  !isActive && 'opacity-40 hover:opacity-80 scale-95 grayscale',
                )}
                onClick={() => {
                  if (!isActive) {
                    setTool(tool.id)
                    setCatalogCategory(tool.catalogCategory ?? null)
                    
                    // Automatically switch to build mode if we select a tool
                    if (useEditor.getState().mode !== 'build') {
                      useEditor.getState().setMode('build')
                    }
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
              </p>
            </TooltipContent>
          </Tooltip>
        )
      })}
    </div>
  )
}

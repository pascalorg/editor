'use client'

import NextImage from 'next/image'
import { ActionButton } from "./action-button";

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
          <ActionButton
            key={`${tool.id}-${tool.catalogCategory ?? index}`}
            label={tool.label}
            className={cn(
              'rounded-lg duration-300',
              isActive ? 'bg-black/40 hover:bg-black/40 scale-110 z-10' : 'bg-transparent opacity-60 grayscale hover:opacity-100 hover:grayscale-0 hover:bg-black/20 scale-95',
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
            variant="ghost"
          >
            <NextImage
              alt={tool.label}
              className="size-full object-contain"
              height={28}
              src={tool.iconSrc}
              width={28}
            />
          </ActionButton>
        )
      })}
    </div>
  )
}

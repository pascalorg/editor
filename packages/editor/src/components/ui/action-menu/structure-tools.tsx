'use client'

import { type LucideIcon, Layout, DoorOpen, Home, Tent, Square, Box, Fence } from 'lucide-react'
import NextImage from 'next/image'
import { useContextualTools } from '../../../hooks/use-contextual-tools'

import { cn } from '../../../lib/utils'
import useEditor, {
  type CatalogCategory,
  type StructureTool,
} from '../../../store/use-editor'
import { ActionButton } from './action-button'

export type ToolConfig = {
  id: StructureTool
  iconSrc?: string
  icon?: LucideIcon
  label: string
  catalogCategory?: CatalogCategory
}

export const tools: ToolConfig[] = [
  { id: 'wall', icon: Layout, label: 'Wall' },
  { id: 'slab', icon: Fence, label: 'Slab' },
  { id: 'ceiling', icon: Square, label: 'Ceiling' },
  { id: 'roof', icon: Tent, label: 'Gable Roof' },
  { id: 'door', icon: DoorOpen, label: 'Door' },
  { id: 'window', icon: Home, label: 'Window' },
  { id: 'zone', icon: Box, label: 'Zone' },
]

export function StructureTools() {
  const activeTool = useEditor((state) => state.tool)
  const catalogCategory = useEditor((state) => state.catalogCategory)
  const structureLayer = useEditor((state) => state.structureLayer)
  const setTool = useEditor((state) => state.setTool)
  const setCatalogCategory = useEditor((state) => state.setCatalogCategory)

  const contextualTools = useContextualTools()

  // Filter tools based on structureLayer
  const visibleTools =
    structureLayer === 'zones'
      ? tools.filter((t) => t.id === 'zone')
      : tools.filter((t) => t.id !== 'zone')

  const hasActiveTool = visibleTools.some(
    (t) =>
      activeTool === t.id && (t.catalogCategory ? catalogCategory === t.catalogCategory : true),
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
            className={cn(
              'rounded-lg duration-300',
              isActive
                ? 'z-10 scale-110 bg-black/40 hover:bg-black/40'
                : 'scale-95 bg-transparent opacity-60 grayscale hover:bg-black/20 hover:opacity-100 hover:grayscale-0',
            )}
            key={`${tool.id}-${tool.catalogCategory ?? index}`}
            label={tool.label}
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
            {tool.icon ? (
              <tool.icon className="h-7 w-7" />
            ) : (
              <NextImage
                alt={tool.label}
                className="size-full object-contain"
                height={28}
                src={tool.iconSrc!}
                width={28}
              />
            )}
          </ActionButton>
        )
      })}
    </div>
  )
}

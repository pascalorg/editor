'use client'

import NextImage from 'next/image'
import { t } from '../../../i18n'
import { cn } from '../../../lib/utils'
import useEditor, {
  type CatalogCategory,
  type StructureTool,
} from '../../../store/use-editor'
import { ActionButton } from './action-button'

export type ToolConfig = {
  id: StructureTool
  iconSrc: string
  label: string
  catalogCategory?: CatalogCategory
}

export const tools: ToolConfig[] = [
  { id: 'wall', iconSrc: '/icons/wall.png', label: 'Wall' },
  { id: 'door', iconSrc: '/icons/door.png', label: 'Door' },
  { id: 'window', iconSrc: '/icons/window.png', label: 'Window' },
  { id: 'stair', iconSrc: '/icons/stairs.png', label: 'Stairs' },
  { id: 'roof', iconSrc: '/icons/roof.png', label: 'Gable Roof' },
  { id: 'fence', iconSrc: '/icons/fence.png', label: 'Fence' },
  { id: 'pipe', iconSrc: '/icons/custom-room.png', label: 'Pipe' },
  { id: 'column', iconSrc: '/icons/column.png', label: 'Column' },
  { id: 'elevator', iconSrc: '/icons/elevator.png', label: 'Elevator' },
  { id: 'slab', iconSrc: '/icons/floor.png', label: 'Slab' },
  { id: 'ceiling', iconSrc: '/icons/ceiling.png', label: 'Ceiling' },
  { id: 'zone', iconSrc: '/icons/zone.png', label: 'Zone' },
  { id: 'spawn', iconSrc: '/icons/site.png', label: 'Spawn Point' },
  { id: 'shelf', iconSrc: '/icons/shelf.png', label: 'Shelf' },
]

const STRUCTURE_TOOL_KEYS: Partial<Record<StructureTool, string>> = {
  wall: 'wall',
  door: 'door',
  window: 'window',
  stair: 'stair',
  roof: 'roof',
  fence: 'fence',
  pipe: 'pipe',
  column: 'column',
  elevator: 'elevator',
  slab: 'slab',
  ceiling: 'ceiling',
  zone: 'zone',
  spawn: 'spawn',
  shelf: 'shelf',
}

export function getStructureToolLabel(id: StructureTool, fallback: string): string {
  const key = STRUCTURE_TOOL_KEYS[id]
  return key ? t(`actionMenu.structureTools.${key}`, fallback) : fallback
}

export function StructureTools() {
  const activeTool = useEditor((state) => state.tool)
  const catalogCategory = useEditor((state) => state.catalogCategory)
  const structureLayer = useEditor((state) => state.structureLayer)
  const setTool = useEditor((state) => state.setTool)
  const setCatalogCategory = useEditor((state) => state.setCatalogCategory)

  const visibleTools =
    structureLayer === 'zones'
      ? tools.filter((tool) => tool.id === 'zone')
      : tools.filter((tool) => tool.id !== 'zone')

  return (
    <div className="flex items-center gap-1.5 px-1">
      {visibleTools.map((tool, index) => {
        const isActive =
          activeTool === tool.id &&
          (tool.catalogCategory ? catalogCategory === tool.catalogCategory : true)

        const label = getStructureToolLabel(tool.id, tool.label)

        return (
          <ActionButton
            className={cn(
              'rounded-lg duration-300',
              isActive
                ? 'z-10 scale-110 bg-black/40 hover:bg-black/40'
                : 'scale-95 bg-transparent opacity-60 grayscale hover:bg-black/20 hover:opacity-100 hover:grayscale-0',
            )}
            key={`${tool.id}-${tool.catalogCategory ?? index}`}
            label={label}
            onClick={() => {
              if (!isActive) {
                setTool(tool.id)
                setCatalogCategory(tool.catalogCategory ?? null)

                if (useEditor.getState().mode !== 'build') {
                  useEditor.getState().setMode('build')
                }
              }
            }}
            size="icon"
            variant="ghost"
          >
            <NextImage alt={label} className="size-full object-contain" height={28} src={tool.iconSrc} width={28} />
          </ActionButton>
        )
      })}
    </div>
  )
}

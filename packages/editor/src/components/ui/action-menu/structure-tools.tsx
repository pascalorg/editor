'use client'

import NextImage from 'next/image'
import { t } from '../../../i18n'
import { cn } from '../../../lib/utils'
import useEditor, {
  type CatalogCategory,
  type StairPlacementType,
  type StructureTool,
} from '../../../store/use-editor'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../primitives/dropdown-menu'
import { ActionButton } from './action-button'

export type ToolConfig = {
  id: StructureTool
  iconSrc: string
  label: string
  catalogCategory?: CatalogCategory
}

type StairVariantConfig = {
  id: StairPlacementType | 'ladder'
  label: string
  tool: StructureTool
}

export const tools: ToolConfig[] = [
  { id: 'wall', iconSrc: '/icons/wall.png', label: 'Wall' },
  { id: 'door', iconSrc: '/icons/door.png', label: 'Door' },
  { id: 'window', iconSrc: '/icons/window.png', label: 'Window' },
  { id: 'stair', iconSrc: '/icons/stairs.png', label: 'Stairs' },
  { id: 'roof', iconSrc: '/icons/roof.png', label: 'Gable Roof' },
  { id: 'fence', iconSrc: '/icons/fence.png', label: 'Fence' },
  { id: 'road', iconSrc: '/icons/road.svg', label: 'Road' },
  { id: 'column', iconSrc: '/icons/column.png', label: 'Column' },
  { id: 'elevator', iconSrc: '/icons/elevator.png', label: 'Elevator' },
  { id: 'slab', iconSrc: '/icons/floor.png', label: 'Slab' },
  { id: 'ceiling', iconSrc: '/icons/ceiling.png', label: 'Ceiling' },
  { id: 'zone', iconSrc: '/icons/zone.png', label: 'Zone' },
  { id: 'spawn', iconSrc: '/icons/site.png', label: 'Spawn Point' },
  { id: 'shelf', iconSrc: '/icons/shelf.png', label: 'Shelf' },
]

export const dataTools: ToolConfig[] = [
  { id: 'data-widget', iconSrc: '/icons/data-widget.svg', label: 'Data Widget' },
]

export const industrialTools: ToolConfig[] = [
  { id: 'tank', iconSrc: '/icons/tank.svg', label: 'Tank' },
  { id: 'pipe', iconSrc: '/icons/pipe.svg', label: 'Pipe' },
  { id: 'pipe-fitting', iconSrc: '/icons/pipe-fitting.svg', label: 'Pipe fitting' },
  { id: 'cable-tray', iconSrc: '/icons/pipe.svg', label: 'Cable tray' },
  { id: 'steel-beam', iconSrc: '/icons/column.png', label: 'Steel beam' },
]

const stairVariants: StairVariantConfig[] = [
  { id: 'straight', label: 'Straight stair', tool: 'stair' },
  { id: 'curved', label: 'Curved stair', tool: 'stair' },
  { id: 'spiral', label: 'Spiral stair', tool: 'stair' },
  { id: 'ladder', label: 'Ladder', tool: 'ladder' },
]

const STRUCTURE_TOOL_KEYS: Partial<Record<StructureTool, string>> = {
  wall: 'wall',
  door: 'door',
  window: 'window',
  stair: 'stair',
  roof: 'roof',
  fence: 'fence',
  road: 'road',
  pipe: 'pipe',
  'pipe-fitting': 'pipeFitting',
  tank: 'tank',
  'cable-tray': 'cableTray',
  ladder: 'ladder',
  'steel-beam': 'steelBeam',
  column: 'column',
  elevator: 'elevator',
  slab: 'slab',
  ceiling: 'ceiling',
  zone: 'zone',
  spawn: 'spawn',
  'data-widget': 'dataWidget',
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
  const stairPlacementType = useEditor((state) => state.stairPlacementType)
  const setTool = useEditor((state) => state.setTool)
  const setCatalogCategory = useEditor((state) => state.setCatalogCategory)
  const setStairPlacementType = useEditor((state) => state.setStairPlacementType)

  const visibleTools =
    structureLayer === 'zones'
      ? tools.filter((tool) => tool.id === 'zone')
      : structureLayer === 'data'
        ? dataTools
      : structureLayer === 'industrial'
        ? industrialTools
      : tools.filter((tool) => tool.id !== 'zone')

  return (
    <div
      className={cn(
        'flex items-center px-1',
        structureLayer === 'industrial' ? 'gap-1' : 'gap-1.5',
      )}
    >
      {visibleTools.map((tool, index) => {
        const isActive =
          (tool.id === 'stair'
            ? activeTool === 'stair' || activeTool === 'ladder'
            : activeTool === tool.id) &&
          (tool.catalogCategory ? catalogCategory === tool.catalogCategory : true)
        const usesTintedIcon = structureLayer === 'data' || structureLayer === 'industrial'

        const label = getStructureToolLabel(tool.id, tool.label)
        const activateTool = (targetTool: StructureTool, placementType?: StairPlacementType) => {
          if (placementType) setStairPlacementType(placementType)
          setTool(targetTool)
          setCatalogCategory(tool.catalogCategory ?? null)

          if (useEditor.getState().mode !== 'build') {
            useEditor.getState().setMode('build')
          }
        }
        const button = (
          <ActionButton
            className={cn(
              'rounded-lg duration-300',
              structureLayer === 'industrial' && 'h-8 w-8',
              isActive
                ? cn(
                    'z-10 scale-110 bg-black/40 hover:bg-black/40',
                    usesTintedIcon && 'text-violet-400',
                  )
                : cn(
                    'scale-95 bg-transparent opacity-60 hover:bg-black/20 hover:opacity-100',
                    usesTintedIcon
                      ? 'text-muted-foreground hover:text-violet-400'
                      : 'grayscale hover:grayscale-0',
                  ),
            )}
            key={`${tool.id}-${tool.catalogCategory ?? index}`}
            label={label}
            onClick={() => {
              if (tool.id === 'stair') return
              if (!isActive) {
                activateTool(tool.id)
              }
            }}
            size="icon"
            variant="ghost"
          >
            {usesTintedIcon ? (
              <span
                aria-hidden="true"
                className={cn(
                  'bg-current transition-colors duration-200',
                  structureLayer === 'industrial' ? 'h-6 w-6' : 'h-7 w-7',
                )}
                style={{
                  mask: `url(${tool.iconSrc}) center / contain no-repeat`,
                  WebkitMask: `url(${tool.iconSrc}) center / contain no-repeat`,
                }}
              />
            ) : (
              <NextImage
                alt={label}
                className="size-full object-contain"
                height={28}
                src={tool.iconSrc}
                width={28}
              />
            )}
          </ActionButton>
        )

        if (tool.id === 'stair') {
          const activeVariant = activeTool === 'ladder' ? 'ladder' : stairPlacementType
          return (
            <DropdownMenu key={`${tool.id}-${tool.catalogCategory ?? index}`}>
              <DropdownMenuTrigger asChild>{button}</DropdownMenuTrigger>
              <DropdownMenuContent align="center" side="top">
                {stairVariants.map((variant) => (
                  <DropdownMenuItem
                    className="justify-between"
                    key={variant.id}
                    onSelect={() => {
                      activateTool(
                        variant.tool,
                        variant.id === 'ladder' ? undefined : variant.id,
                      )
                    }}
                  >
                    <span>{t(`actionMenu.stairTypes.${variant.id}`, variant.label)}</span>
                    {activeVariant === variant.id ? <span className="text-xs">✓</span> : null}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )
        }

        return button
      })}
    </div>
  )
}

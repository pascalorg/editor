'use client'

import NextImage from 'next/image'
import { t } from '../../../i18n'
import { cn } from '../../../lib/utils'
import useEditor, { type CatalogCategory, type StructureTool } from '../../../store/use-editor'
import { ActionButton } from './action-button'

export type ToolConfig = {
  id: StructureTool
  iconSrc: string
  label: string
  catalogCategory?: CatalogCategory
}


export const tools: ToolConfig[] = [
  { id: 'wall', iconSrc: '/icons/wall.webp', label: 'Wall' },
  { id: 'door', iconSrc: '/icons/door.webp', label: 'Door' },
  { id: 'window', iconSrc: '/icons/window.webp', label: 'Window' },
  { id: 'stair', iconSrc: '/icons/stairs.webp', label: 'Stairs' },
  { id: 'roof', iconSrc: '/icons/roof.webp', label: 'Gable Roof' },
  { id: 'fence', iconSrc: '/icons/fence.webp', label: 'Fence' },
  { id: 'road', iconSrc: '/icons/road.svg', label: '\u5730\u9762\u5e26' },
  { id: 'column', iconSrc: '/icons/column.webp', label: 'Column' },
  { id: 'elevator', iconSrc: '/icons/elevator.webp', label: 'Elevator' },
  { id: 'slab', iconSrc: '/icons/floor.webp', label: 'Slab' },
  { id: 'ceiling', iconSrc: '/icons/ceiling.webp', label: 'Ceiling' },
  { id: 'zone', iconSrc: '/icons/zone.webp', label: 'Zone' },
  { id: 'spawn', iconSrc: '/icons/site.webp', label: 'Spawn Point' },
]

export const dataTools: ToolConfig[] = [
  { id: 'data-widget', iconSrc: '/icons/data-widget.svg', label: '\u5355\u6807\u7b7e' },
  { id: 'data-chart', iconSrc: '/icons/data-chart.svg', label: '图表' },
  { id: 'data-table', iconSrc: '/icons/data-table.svg', label: '列表' },
]

export const industrialTools: ToolConfig[] = [
  { id: 'tank', iconSrc: '/icons/tank.svg', label: 'Tank' },
  { id: 'pipe', iconSrc: '/icons/pipe.svg', label: 'Pipe' },
  { id: 'conveyor-belt', iconSrc: '/icons/pipe.svg', label: 'Conveyor belt' },
  { id: 'pipe-fitting', iconSrc: '/icons/pipe-fitting.svg', label: 'Pipe fitting' },
  { id: 'cable-tray', iconSrc: '/icons/pipe.svg', label: 'Cable tray' },
  { id: 'steel-beam', iconSrc: '/icons/column.webp', label: 'Steel beam' },
  { id: 'steel-frame', iconSrc: '/icons/column.webp', label: '\u94a2\u67b6' },
  { id: 'shelf', iconSrc: '/icons/shelf.webp', label: '\u8d27\u67b6' },
]


const STRUCTURE_TOOL_KEYS: Partial<Record<StructureTool, string>> = {
  wall: 'wall',
  door: 'door',
  window: 'window',
  stair: 'stair',
  roof: 'roof',
  fence: 'fence',
  road: 'groundStrip',
  pipe: 'pipe',
  'conveyor-belt': 'conveyorBelt',
  'pipe-fitting': 'pipeFitting',
  tank: 'tank',
  'cable-tray': 'cableTray',
  ladder: 'ladder',
  'steel-beam': 'steelBeam',
  'steel-frame': 'steelFrame',
  column: 'column',
  elevator: 'elevator',
  slab: 'slab',
  ceiling: 'ceiling',
  zone: 'zone',
  spawn: 'spawn',
  'data-widget': 'dataWidget',
  'data-chart': 'dataChart',
  'data-table': 'dataTable',
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
  const setStairPlacementType = useEditor((state) => state.setStairPlacementType)
  const setCatalogCategory = useEditor((state) => state.setCatalogCategory)

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
          activeTool === tool.id &&
          (tool.catalogCategory ? catalogCategory === tool.catalogCategory : true)
        const usesTintedIcon = structureLayer === 'data' || structureLayer === 'industrial'

        const label = getStructureToolLabel(tool.id, tool.label)
        const activateTool = (targetTool: StructureTool) => {
          if (targetTool === 'stair') setStairPlacementType('straight')
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

        return button
      })}
    </div>
  )
}

import type { MessageDescriptor } from '@pascal-app/core'
import type { CatalogCategory, StructureTool } from '../../../store/use-editor'

export type ToolConfig = {
  id: StructureTool
  iconSrc: string
  label: MessageDescriptor
  catalogCategory?: CatalogCategory
}

// Shared structure-tool metadata (icons + labels). The build palette now lives
// in the community Build sidebar; this list survives only as the lookup table
// for cursor/floorplan indicators. Roof-mounted accessories are intentionally
// absent — they're placed from the roof inspector's "Add element" section.
export const tools: ToolConfig[] = [
  { id: 'wall', iconSrc: '/icons/wall.webp', label: /* i18n */ { id: 'editor.actionMenu.structureTools.wall', message: 'Wall' } },
  { id: 'door', iconSrc: '/icons/door.webp', label: /* i18n */ { id: 'editor.actionMenu.structureTools.door', message: 'Door' } },
  { id: 'window', iconSrc: '/icons/window.webp', label: /* i18n */ { id: 'editor.actionMenu.structureTools.window', message: 'Window' } },
  { id: 'stair', iconSrc: '/icons/stairs.webp', label: /* i18n */ { id: 'editor.actionMenu.structureTools.stairs', message: 'Stairs' } },
  { id: 'roof', iconSrc: '/icons/roof.webp', label: /* i18n */ { id: 'editor.actionMenu.structureTools.gableRoof', message: 'Gable Roof' } },
  { id: 'fence', iconSrc: '/icons/fence.webp', label: /* i18n */ { id: 'editor.actionMenu.structureTools.fence', message: 'Fence' } },
  { id: 'column', iconSrc: '/icons/column.webp', label: /* i18n */ { id: 'editor.actionMenu.structureTools.column', message: 'Column' } },
  { id: 'elevator', iconSrc: '/icons/elevator.webp', label: /* i18n */ { id: 'editor.actionMenu.structureTools.elevator', message: 'Elevator' } },
  { id: 'slab', iconSrc: '/icons/floor.webp', label: /* i18n */ { id: 'editor.actionMenu.structureTools.slab', message: 'Slab' } },
  { id: 'ceiling', iconSrc: '/icons/ceiling.webp', label: /* i18n */ { id: 'editor.actionMenu.structureTools.ceiling', message: 'Ceiling' } },
  { id: 'zone', iconSrc: '/icons/zone.webp', label: /* i18n */ { id: 'editor.actionMenu.structureTools.zone', message: 'Zone' } },
  { id: 'spawn', iconSrc: '/icons/spawn-point.webp', label: /* i18n */ { id: 'editor.actionMenu.structureTools.spawnPoint', message: 'Spawn Point' } },
  { id: 'shelf', iconSrc: '/icons/shelf.webp', label: /* i18n */ { id: 'editor.actionMenu.structureTools.shelf', message: 'Shelf' } },
  { id: 'duct-segment', iconSrc: '/icons/duct.webp', label: /* i18n */ { id: 'editor.actionMenu.structureTools.duct', message: 'Duct' } },
  { id: 'duct-fitting', iconSrc: '/icons/duct-fitting.webp', label: /* i18n */ { id: 'editor.actionMenu.structureTools.ductFitting', message: 'Duct Fitting' } },
  { id: 'duct-terminal', iconSrc: '/icons/registers.webp', label: /* i18n */ { id: 'editor.actionMenu.structureTools.register', message: 'Register' } },
  { id: 'hvac-equipment', iconSrc: '/icons/HVAC.webp', label: /* i18n */ { id: 'editor.actionMenu.structureTools.hvacUnit', message: 'HVAC Unit' } },
  { id: 'pipe-segment', iconSrc: '/icons/dwv-pipes.webp', label: /* i18n */ { id: 'editor.actionMenu.structureTools.dwvPipe', message: 'DWV Pipe' } },
  { id: 'pipe-trap', iconSrc: '/icons/dwv-pipes.webp', label: /* i18n */ { id: 'editor.actionMenu.structureTools.trap', message: 'Trap' } },
  { id: 'pipe-fitting', iconSrc: '/icons/duct-fitting.webp', label: /* i18n */ { id: 'editor.actionMenu.structureTools.pipeFitting', message: 'Pipe Fitting' } },
  { id: 'lineset', iconSrc: '/icons/lineset.webp', label: /* i18n */ { id: 'editor.actionMenu.structureTools.lineset', message: 'Lineset' } },
  { id: 'liquid-line', iconSrc: '/icons/lineset.webp', label: /* i18n */ { id: 'editor.actionMenu.structureTools.liquidLine', message: 'Liquid Line' } },
]

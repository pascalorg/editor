import type { CatalogCategory, StructureTool } from '../../../store/use-editor'

export type ToolConfig = {
  id: StructureTool
  iconSrc: string
  labelKey: string
  catalogCategory?: CatalogCategory
}

// Shared structure-tool metadata (icons + labels). The build palette now lives
// in the community Build sidebar; this list survives only as the lookup table
// for cursor/floorplan indicators. Roof-mounted accessories are intentionally
// absent — they're placed from the roof inspector's "Add element" section.
export const tools: ToolConfig[] = [
  { id: 'wall', iconSrc: '/icons/wall.webp', labelKey: 'structureTools.wall' },
  { id: 'door', iconSrc: '/icons/door.webp', labelKey: 'structureTools.door' },
  { id: 'window', iconSrc: '/icons/window.webp', labelKey: 'structureTools.window' },
  { id: 'stair', iconSrc: '/icons/stairs.webp', labelKey: 'structureTools.stairs' },
  { id: 'roof', iconSrc: '/icons/roof.webp', labelKey: 'structureTools.gableRoof' },
  { id: 'fence', iconSrc: '/icons/fence.webp', labelKey: 'structureTools.fence' },
  { id: 'column', iconSrc: '/icons/column.webp', labelKey: 'structureTools.column' },
  { id: 'elevator', iconSrc: '/icons/elevator.webp', labelKey: 'structureTools.elevator' },
  { id: 'slab', iconSrc: '/icons/floor.webp', labelKey: 'structureTools.slab' },
  { id: 'ceiling', iconSrc: '/icons/ceiling.webp', labelKey: 'structureTools.ceiling' },
  { id: 'zone', iconSrc: '/icons/zone.webp', labelKey: 'structureTools.zone' },
  { id: 'spawn', iconSrc: '/icons/spawn-point.webp', labelKey: 'structureTools.spawnPoint' },
  { id: 'shelf', iconSrc: '/icons/shelf.webp', labelKey: 'structureTools.shelf' },
  { id: 'duct-segment', iconSrc: '/icons/duct.webp', labelKey: 'structureTools.duct' },
  { id: 'duct-fitting', iconSrc: '/icons/duct-fitting.webp', labelKey: 'structureTools.ductFitting' },
  { id: 'duct-terminal', iconSrc: '/icons/registers.webp', labelKey: 'structureTools.register' },
  { id: 'hvac-equipment', iconSrc: '/icons/HVAC.webp', labelKey: 'structureTools.hvacUnit' },
  { id: 'pipe-segment', iconSrc: '/icons/dwv-pipes.webp', labelKey: 'structureTools.dwvPipe' },
  { id: 'pipe-trap', iconSrc: '/icons/dwv-pipes.webp', labelKey: 'structureTools.trap' },
  { id: 'pipe-fitting', iconSrc: '/icons/duct-fitting.webp', labelKey: 'structureTools.pipeFitting' },
  { id: 'lineset', iconSrc: '/icons/lineset.webp', labelKey: 'structureTools.lineset' },
  { id: 'liquid-line', iconSrc: '/icons/lineset.webp', labelKey: 'structureTools.liquidLine' },
]
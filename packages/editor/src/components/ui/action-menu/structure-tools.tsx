import type { CatalogCategory, StructureTool } from '../../../store/use-editor'

export type ToolConfig = {
  id: StructureTool
  iconSrc: string
  label: string
  catalogCategory?: CatalogCategory
}

// Shared structure-tool metadata (icons + labels). The build palette now lives
// in the community Build sidebar; this list survives only as the lookup table
// for cursor/floorplan indicators. Roof-mounted accessories are intentionally
// absent — they're placed from the roof inspector's "Add element" section.
export const tools: ToolConfig[] = [
  { id: 'wall', iconSrc: '/icons/wall.webp', label: 'Wall' },
  { id: 'door', iconSrc: '/icons/door.webp', label: 'Door' },
  { id: 'window', iconSrc: '/icons/window.webp', label: 'Window' },
  { id: 'stair', iconSrc: '/icons/stairs.webp', label: 'Stairs' },
  { id: 'roof', iconSrc: '/icons/roof.webp', label: 'Gable Roof' },
  { id: 'fence', iconSrc: '/icons/fence.webp', label: 'Fence' },
  { id: 'column', iconSrc: '/icons/column.webp', label: 'Column' },
  { id: 'elevator', iconSrc: '/icons/elevator.webp', label: 'Elevator' },
  { id: 'slab', iconSrc: '/icons/floor.webp', label: 'Slab' },
  { id: 'ceiling', iconSrc: '/icons/ceiling.webp', label: 'Ceiling' },
  { id: 'zone', iconSrc: '/icons/zone.webp', label: 'Zone' },
  { id: 'spawn', iconSrc: '/icons/spawn-point.webp', label: 'Spawn Point' },
  { id: 'shelf', iconSrc: '/icons/shelf.webp', label: 'Shelf' },
  { id: 'duct-segment', iconSrc: '/icons/duct.webp', label: 'Duct' },
  { id: 'duct-fitting', iconSrc: '/icons/duct-fitting.webp', label: 'Duct Fitting' },
  { id: 'duct-terminal', iconSrc: '/icons/registers.webp', label: 'Register' },
  { id: 'hvac-equipment', iconSrc: '/icons/HVAC.webp', label: 'HVAC Unit' },
  { id: 'pipe-segment', iconSrc: '/icons/dwv-pipes.webp', label: 'DWV Pipe' },
  { id: 'pipe-trap', iconSrc: '/icons/dwv-pipes.webp', label: 'Trap' },
  { id: 'pipe-fitting', iconSrc: '/icons/duct-fitting.webp', label: 'Pipe Fitting' },
  { id: 'lineset', iconSrc: '/icons/lineset.webp', label: 'Lineset' },
  { id: 'liquid-line', iconSrc: '/icons/lineset.webp', label: 'Liquid Line' },
]

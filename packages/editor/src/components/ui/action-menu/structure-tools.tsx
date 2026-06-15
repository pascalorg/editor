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
  { id: 'wall', iconSrc: '/icons/wall.png', label: 'Wall' },
  { id: 'door', iconSrc: '/icons/door.png', label: 'Door' },
  { id: 'window', iconSrc: '/icons/window.png', label: 'Window' },
  { id: 'stair', iconSrc: '/icons/stairs.png', label: 'Stairs' },
  { id: 'roof', iconSrc: '/icons/roof.png', label: 'Gable Roof' },
  { id: 'fence', iconSrc: '/icons/fence.png', label: 'Fence' },
  { id: 'column', iconSrc: '/icons/column.png', label: 'Column' },
  { id: 'elevator', iconSrc: '/icons/elevator.png', label: 'Elevator' },
  { id: 'slab', iconSrc: '/icons/floor.png', label: 'Slab' },
  { id: 'ceiling', iconSrc: '/icons/ceiling.png', label: 'Ceiling' },
  { id: 'zone', iconSrc: '/icons/zone.png', label: 'Zone' },
  { id: 'spawn', iconSrc: '/icons/spawn-point.png', label: 'Spawn Point' },
  { id: 'shelf', iconSrc: '/icons/shelf.png', label: 'Shelf' },
  { id: 'duct-segment', iconSrc: '/icons/duct.png', label: 'Duct' },
  { id: 'duct-fitting', iconSrc: '/icons/duct-fitting.png', label: 'Duct Fitting' },
  { id: 'duct-terminal', iconSrc: '/icons/registers.png', label: 'Register' },
  { id: 'hvac-equipment', iconSrc: '/icons/HVAC.png', label: 'HVAC Unit' },
  { id: 'pipe-segment', iconSrc: '/icons/dwv-pipes.png', label: 'DWV Pipe' },
  { id: 'pipe-fitting', iconSrc: '/icons/duct-fitting.png', label: 'Pipe Fitting' },
  { id: 'lineset', iconSrc: '/icons/lineset.png', label: 'Lineset' },
]

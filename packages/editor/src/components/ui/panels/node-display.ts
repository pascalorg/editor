import type { AnyNode } from '@pascal-app/core'

export type NodeDisplay = {
  icon: string
  label: string
}

const TYPE_DEFAULTS: Record<string, NodeDisplay> = {
  item: { icon: '/icons/item.webp', label: 'Item' },
  wall: { icon: '/icons/wall.webp', label: 'Wall' },
  door: { icon: '/icons/door.webp', label: 'Door' },
  window: { icon: '/icons/window.webp', label: 'Window' },
  slab: { icon: '/icons/floor.webp', label: 'Slab' },
  ceiling: { icon: '/icons/ceiling.webp', label: 'Ceiling' },
  column: { icon: '/icons/column.webp', label: 'Column' },
  elevator: { icon: '/icons/elevator.webp', label: 'Elevator' },
  fence: { icon: '/icons/fence.webp', label: 'Fence' },
  roof: { icon: '/icons/roof.webp', label: 'Roof' },
  'roof-segment': { icon: '/icons/roof.webp', label: 'Roof segment' },
  stair: { icon: '/icons/stairs.webp', label: 'Stair' },
  'stair-segment': { icon: '/icons/stairs.webp', label: 'Stair segment' },
  scan: { icon: '/icons/mesh.webp', label: '3D Scan' },
  guide: { icon: '/icons/floorplan.webp', label: 'Guide image' },
  'cable-tray': { icon: '/icons/pipe.svg', label: 'Cable tray' },
  ladder: { icon: '/icons/stairs.webp', label: 'Ladder' },
  'steel-beam': { icon: '/icons/column.webp', label: 'Steel beam' },
  'data-widget': { icon: '/icons/data-widget.svg', label: 'Data widget' },
  'data-chart': { icon: '/icons/data-chart.svg', label: 'Chart widget' },
  'data-table': { icon: '/icons/data-table.svg', label: 'Table widget' },
}

export function getNodeDisplay(node: AnyNode | null | undefined): NodeDisplay {
  if (!node) return { icon: '/icons/select.webp', label: 'Selection' }
  const fallback = TYPE_DEFAULTS[node.type] ?? { icon: '/icons/select.webp', label: node.type }
  // Item nodes carry an asset with its own thumbnail/name
  if (node.type === 'item') {
    return {
      icon: node.asset?.thumbnail || fallback.icon,
      label: node.name || node.asset?.name || fallback.label,
    }
  }
  return {
    icon: fallback.icon,
    label: node.name || fallback.label,
  }
}

import type { AnyNode } from '@pascal-app/core'

export type NodeDisplay = {
  icon: string
  label: string
}

const TYPE_DEFAULTS: Record<string, NodeDisplay> = {
  item: { icon: '/icons/furniture.webp', label: 'Item' },
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
  stair: { icon: '/icons/stair.webp', label: 'Stair' },
  'stair-segment': { icon: '/icons/stair.webp', label: 'Stair segment' },
  scan: { icon: '/icons/mesh.webp', label: '3D Scan' },
  guide: { icon: '/icons/floorplan.webp', label: 'Guide image' },
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

import type { AnyNode } from '@pascal-app/core'

export type NodeDisplay = {
  icon: string
  label: string
}

const TYPE_DEFAULTS: Record<string, NodeDisplay> = {
  item: { icon: '/icons/furniture.png', label: 'Item' },
  wall: { icon: '/icons/wall.png', label: 'Wall' },
  door: { icon: '/icons/door.png', label: 'Door' },
  window: { icon: '/icons/window.png', label: 'Window' },
  slab: { icon: '/icons/floor.png', label: 'Slab' },
  ceiling: { icon: '/icons/ceiling.png', label: 'Ceiling' },
  column: { icon: '/icons/column.png', label: 'Column' },
  fence: { icon: '/icons/fence.png', label: 'Fence' },
  roof: { icon: '/icons/roof.png', label: 'Roof' },
  'roof-segment': { icon: '/icons/roof.png', label: 'Roof segment' },
  stair: { icon: '/icons/stair.png', label: 'Stair' },
  'stair-segment': { icon: '/icons/stair.png', label: 'Stair segment' },
  scan: { icon: '/icons/mesh.png', label: '3D Scan' },
  guide: { icon: '/icons/floorplan.png', label: 'Guide image' },
}

export function getNodeDisplay(node: AnyNode | null | undefined): NodeDisplay {
  if (!node) return { icon: '/icons/select.png', label: 'Selection' }
  const fallback = TYPE_DEFAULTS[node.type] ?? { icon: '/icons/select.png', label: node.type }
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

import { type AnyNode, type MessageDescriptor, type PascalI18n, scriptImages } from '@pascal-app/core'
import { displayRoomName } from '../../../lib/room-name-messages'

export type NodeDisplay = {
  icon: string
  label: string
}

const TYPE_DEFAULTS: Record<string, { icon: string; label: MessageDescriptor }> = {
  item: { icon: '/icons/item.webp', label: /* i18n */ { id: 'editor.nodeDisplay.item', message: 'Item' } },
  wall: { icon: '/icons/wall.webp', label: /* i18n */ { id: 'editor.nodeDisplay.wall', message: 'Wall' } },
  door: { icon: '/icons/door.webp', label: /* i18n */ { id: 'editor.nodeDisplay.door', message: 'Door' } },
  window: { icon: '/icons/window.webp', label: /* i18n */ { id: 'editor.nodeDisplay.window', message: 'Window' } },
  slab: { icon: '/icons/floor.webp', label: /* i18n */ { id: 'editor.nodeDisplay.slab', message: 'Slab' } },
  ceiling: { icon: '/icons/ceiling.webp', label: /* i18n */ { id: 'editor.nodeDisplay.ceiling', message: 'Ceiling' } },
  column: { icon: '/icons/column.webp', label: /* i18n */ { id: 'editor.nodeDisplay.column', message: 'Column' } },
  elevator: { icon: '/icons/elevator.webp', label: /* i18n */ { id: 'editor.nodeDisplay.elevator', message: 'Elevator' } },
  fence: { icon: '/icons/fence.webp', label: /* i18n */ { id: 'editor.nodeDisplay.fence', message: 'Fence' } },
  roof: { icon: '/icons/roof.webp', label: /* i18n */ { id: 'editor.nodeDisplay.roof', message: 'Roof' } },
  'roof-segment': { icon: '/icons/roof.webp', label: /* i18n */ { id: 'editor.nodeDisplay.roofSegment', message: 'Roof segment' } },
  stair: { icon: '/icons/stairs.webp', label: /* i18n */ { id: 'editor.nodeDisplay.stair', message: 'Stair' } },
  'stair-segment': { icon: '/icons/stairs.webp', label: /* i18n */ { id: 'editor.nodeDisplay.stairSegment', message: 'Stair segment' } },
  scan: { icon: '/icons/mesh.webp', label: /* i18n */ { id: 'editor.nodeDisplay.scan', message: '3D Scan' } },
  guide: { icon: '/icons/floorplan.webp', label: /* i18n */ { id: 'editor.nodeDisplay.guide', message: 'Guide image' } },
  zone: { icon: '/icons/zone.webp', label: /* i18n */ { id: 'editor.nodeDisplay.zone', message: 'Zone' } },
}

export function getTypeDisplay(type: string, i18n: PascalI18n): NodeDisplay {
  const known = TYPE_DEFAULTS[type]
  return known ? { icon: known.icon, label: i18n._(known.label) } : { icon: '/icons/select.webp', label: type }
}

export function getNodeDisplay(node: AnyNode | null | undefined, i18n: PascalI18n): NodeDisplay {
  if (!node)
    return {
      icon: '/icons/select.webp',
      label: i18n._({ id: 'editor.nodeDisplay.selection', message: 'Selection' }),
    }
  const fallback = getTypeDisplay(node.type, i18n)
  const scripted = scriptImages(node)?.thumbnail
  // Item nodes carry an asset with its own thumbnail/name
  if (node.type === 'item') {
    return {
      icon: scripted ?? (node.asset?.thumbnail || fallback.icon),
      label: node.name || node.asset?.name || fallback.label,
    }
  }
  if (node.type === 'zone' && node.spaceRole === 'room') {
    return {
      icon: '/icons/kitchen.webp',
      label:
        (node.name && displayRoomName(node.name, i18n)) ||
        i18n._({ id: 'editor.nodeDisplay.room', message: 'Room' }),
    }
  }
  return {
    icon: scripted ?? fallback.icon,
    label: node.name || fallback.label,
  }
}

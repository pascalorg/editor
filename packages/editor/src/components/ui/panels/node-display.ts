import type { AnyNode } from '@pascal-app/core'

export type NodeDisplay = {
  icon: string
  label: string
}

// Icons are static; only the labels flow through the i18n catalog so the
// `panel.nodeType.*` keys (added with the i18n restoration on the
// `panel-manager` call sites) can be the single source of truth for both
// the panel-title (`<MobilePanelSheet title>`) and the multi-selection
// breakdown (`formatSelectionBreakdown`) renderings.
const TYPE_ICONS: Record<string, string> = {
  item: '/icons/item.webp',
  wall: '/icons/wall.webp',
  door: '/icons/door.webp',
  window: '/icons/window.webp',
  slab: '/icons/floor.webp',
  ceiling: '/icons/ceiling.webp',
  column: '/icons/column.webp',
  elevator: '/icons/elevator.webp',
  fence: '/icons/fence.webp',
  roof: '/icons/roof.webp',
  'roof-segment': '/icons/roof.webp',
  stair: '/icons/stairs.webp',
  'stair-segment': '/icons/stairs.webp',
  scan: '/icons/mesh.webp',
  guide: '/icons/floorplan.webp',
}

const FALLBACK_ICON = '/icons/select.webp'

// `'roof-segment'` → `'roofSegment'` — matches the i18n key shape so callers
// can do `t(\`panel.nodeType.${camelType(type)}\`)` without manual mapping.
export function camelType(type: string): string {
  return type.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase())
}

export type Translator = (key: string) => string

export function getTypeDisplay(type: string, t: Translator): NodeDisplay {
  const icon = TYPE_ICONS[type] ?? FALLBACK_ICON
  // Preserve the original "unknown type id as label" behavior for kinds
  // without a catalog entry, so future node types render a sensible string
  // before anyone has had a chance to translate them.
  const label = type in TYPE_ICONS ? t(`panel.nodeType.${camelType(type)}`) : type
  return { icon, label }
}

export function getNodeDisplay(node: AnyNode | null | undefined, t: Translator): NodeDisplay {
  if (!node) return { icon: FALLBACK_ICON, label: t('panel.selection') }
  const fallbackIcon = TYPE_ICONS[node.type] ?? FALLBACK_ICON
  const fallbackLabel =
    node.type in TYPE_ICONS ? t(`panel.nodeType.${camelType(node.type)}`) : node.type
  // Item nodes carry an asset with its own thumbnail/name
  if (node.type === 'item') {
    return {
      icon: node.asset?.thumbnail || fallbackIcon,
      label: node.name || node.asset?.name || fallbackLabel,
    }
  }
  return {
    icon: fallbackIcon,
    label: node.name || fallbackLabel,
  }
}
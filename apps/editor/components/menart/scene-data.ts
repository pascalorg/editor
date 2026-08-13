export interface MenartNode {
  id: string
  label: string
  /** Basename of a webp in `public/icons`. */
  icon: string
  /** Right-aligned monospace metric: a height in metres, or a floor area. */
  value: string
  children?: MenartNode[]
}

export const MENART_PROJECT = {
  title: 'Kadıköy Rezidans · Blok A',
  savedAt: 'Kaydedildi 14:32',
  building: { name: 'Blok A', icon: 'building' },
} as const

/** Storeys are the tree roots, and the same list feeds the canvas level switcher. */
export const MENART_LEVELS: MenartNode[] = [
  {
    id: 'level-2',
    label: '2. Kat',
    icon: 'level',
    value: '2.80',
    children: [
      { id: 'l2-slab', label: 'Döşeme', icon: 'floor', value: '86.4 m²' },
      {
        id: 'l2-wall',
        label: 'Dış duvar',
        icon: 'wall',
        value: '4.20',
        children: [{ id: 'l2-window', label: 'Pencere', icon: 'window', value: '1.60' }],
      },
      { id: 'l2-room', label: 'Yatak odası', icon: 'room', value: '18.6 m²' },
    ],
  },
  {
    id: 'level-1',
    label: '1. Kat',
    icon: 'level',
    value: '3.00',
    children: [
      { id: 'l1-slab', label: 'Döşeme', icon: 'floor', value: '86.4 m²' },
      {
        id: 'l1-wall',
        label: 'Dış duvar',
        icon: 'wall',
        value: '4.20',
        children: [
          { id: 'l1-door', label: 'Kapı', icon: 'door', value: '0.90' },
          { id: 'l1-window', label: 'Pencere', icon: 'window', value: '1.60' },
        ],
      },
      { id: 'l1-room', label: 'Salon', icon: 'room', value: '32.1 m²' },
    ],
  },
  {
    id: 'level-0',
    label: 'Zemin kat',
    icon: 'level',
    value: '3.00',
    children: [
      { id: 'l0-slab', label: 'Döşeme', icon: 'floor', value: '92.0 m²' },
      {
        id: 'l0-wall',
        label: 'Dış duvar',
        icon: 'wall',
        value: '5.10',
        children: [{ id: 'l0-door', label: 'Kapı', icon: 'door', value: '1.20' }],
      },
      { id: 'l0-room', label: 'Giriş holü', icon: 'room', value: '14.8 m²' },
    ],
  },
]

export const DEFAULT_LEVEL_ID = 'level-1'
export const DEFAULT_SELECTED_ID = 'l1-wall'
export const DEFAULT_EXPANDED_IDS = ['level-1', 'l1-wall']

/** The room the canvas labels, and the wall the dimension pill measures. */
export const CANVAS_ROOM = { label: 'Salon', area: '32.1 m²' } as const
export const CANVAS_WALL = { length: '4.20 m', thickness: 't 0.20' } as const

export const ASSISTANT_SUGGESTIONS = [
  'Kat alanını hesapla',
  'Tüm pencereleri 1.60 yap',
  'Ölçü zinciri ekle',
]

/**
 * Turkish-aware fold: `toLocaleLowerCase('tr')` keeps "I" and "İ" distinct, so
 * searching "kapı" does not silently miss "KAPI".
 */
function fold(value: string): string {
  return value.toLocaleLowerCase('tr')
}

/**
 * Prunes the tree to the branches matching `query`, and reports the ancestors
 * that have to be forced open for the surviving matches to be visible.
 */
export function searchTree(
  nodes: MenartNode[],
  query: string,
): { nodes: MenartNode[]; expand: string[] } {
  const needle = fold(query.trim())
  if (!needle) return { nodes, expand: [] }

  const expand: string[] = []
  const walk = (list: MenartNode[]): MenartNode[] =>
    list.flatMap((node) => {
      const matchedChildren = node.children ? walk(node.children) : []
      const selfMatches = fold(node.label).includes(needle)
      if (!selfMatches && matchedChildren.length === 0) return []
      if (matchedChildren.length > 0) expand.push(node.id)
      // A node that matches on its own keeps its subtree intact, so the hit can
      // be explored rather than arriving pre-pruned.
      const children = matchedChildren.length > 0 ? matchedChildren : node.children
      return [{ ...node, children }]
    })

  return { nodes: walk(nodes), expand }
}

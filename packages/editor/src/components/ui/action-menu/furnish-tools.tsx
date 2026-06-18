import type { CatalogCategory } from './../../../store/use-editor'
import { t } from '../../../i18n'

export type FurnishToolConfig = {
  id: 'item'
  iconSrc: string
  label: string
  catalogCategory: CatalogCategory
}

export const furnishTools: FurnishToolConfig[] = [
  { id: 'item', iconSrc: '/icons/appliance.webp', label: 'Common Equipment', catalogCategory: 'electronics' },
  { id: 'item', iconSrc: '/icons/shelf.webp', label: 'Equipment', catalogCategory: 'equipment' },
  { id: 'item', iconSrc: '/icons/door.webp', label: 'Structural', catalogCategory: 'structural' },
  { id: 'item', iconSrc: '/icons/tree.webp', label: 'Outdoor', catalogCategory: 'outdoor' },
  { id: 'item', iconSrc: '/icons/collection.webp', label: '\u6211\u7684', catalogCategory: 'mine' },
]

export function getFurnishToolLabel(category: CatalogCategory): string {
  const fallbacks: Partial<Record<CatalogCategory, string>> = {
    electronics: 'Common Equipment',
    equipment: 'Equipment',
    structural: 'Structural',
    outdoor: 'Outdoor',
    mine: '\u6211\u7684',
  }
  return t(`sidebar.furnishCategories.${category}`, fallbacks[category] ?? category)
}

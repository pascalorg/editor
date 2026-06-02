import type { CatalogCategory } from './../../../store/use-editor'
import { t } from '../../../i18n'

export type FurnishToolConfig = {
  id: 'item'
  iconSrc: string
  label: string
  catalogCategory: CatalogCategory
}

export const furnishTools: FurnishToolConfig[] = [
  { id: 'item', iconSrc: '/icons/building.png', label: 'Safety', catalogCategory: 'safety' },
  { id: 'item', iconSrc: '/icons/ceiling.png', label: 'Lighting', catalogCategory: 'lighting' },
  { id: 'item', iconSrc: '/icons/appliance.png', label: 'Common Equipment', catalogCategory: 'electronics' },
  { id: 'item', iconSrc: '/icons/shelf.png', label: 'Equipment', catalogCategory: 'equipment' },
  { id: 'item', iconSrc: '/icons/column.png', label: 'Structural', catalogCategory: 'structural' },
  { id: 'item', iconSrc: '/icons/door.png', label: 'Openings', catalogCategory: 'opening' },
  { id: 'item', iconSrc: '/icons/tree.png', label: 'Outdoor', catalogCategory: 'outdoor' },
  { id: 'item', iconSrc: '/icons/collection.png', label: '\u6211\u7684', catalogCategory: 'mine' },
]

export function getFurnishToolLabel(category: CatalogCategory): string {
  const fallbacks: Partial<Record<CatalogCategory, string>> = {
    safety: 'Safety',
    lighting: 'Lighting',
    electronics: 'Common Equipment',
    equipment: 'Equipment',
    structural: 'Structural',
    opening: 'Openings',
    outdoor: 'Outdoor',
    mine: '\u6211\u7684',
  }
  return t(`sidebar.furnishCategories.${category}`, fallbacks[category] ?? category)
}

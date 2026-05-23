import type { CatalogCategory } from './../../../store/use-editor'
import { t } from '../../../i18n'

export type FurnishToolConfig = {
  id: 'item'
  iconSrc: string
  label: string
  catalogCategory: CatalogCategory
}

export const furnishTools: FurnishToolConfig[] = [
  { id: 'item', iconSrc: '/icons/couch.png', label: 'Furniture', catalogCategory: 'furniture' },
  { id: 'item', iconSrc: '/icons/appliance.png', label: 'Appliance', catalogCategory: 'appliance' },
  { id: 'item', iconSrc: '/icons/kitchen.png', label: 'Kitchen', catalogCategory: 'kitchen' },
  { id: 'item', iconSrc: '/icons/bathroom.png', label: 'Bathroom', catalogCategory: 'bathroom' },
  { id: 'item', iconSrc: '/icons/tree.png', label: 'Outdoor', catalogCategory: 'outdoor' },
]

export function getFurnishToolLabel(category: CatalogCategory): string {
  const fallbacks: Partial<Record<CatalogCategory, string>> = {
    furniture: 'Furniture',
    appliance: 'Appliance',
    kitchen: 'Kitchen',
    bathroom: 'Bathroom',
    outdoor: 'Outdoor',
  }
  return t(`sidebar.furnishCategories.${category}`, fallbacks[category] ?? category)
}

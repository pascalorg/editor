import type { CatalogCategory } from './../../../store/use-editor'

export type FurnishToolConfig = {
  id: 'item'
  iconSrc: string
  labelKey: string
  catalogCategory: CatalogCategory
}

export const furnishTools: FurnishToolConfig[] = [
  { id: 'item', iconSrc: '/icons/couch.webp', labelKey: 'furnishTools.furniture', catalogCategory: 'furniture' },
  { id: 'item', iconSrc: '/icons/appliance.webp', labelKey: 'furnishTools.appliance', catalogCategory: 'appliance' },
  { id: 'item', iconSrc: '/icons/kitchen.webp', labelKey: 'furnishTools.kitchen', catalogCategory: 'kitchen' },
  { id: 'item', iconSrc: '/icons/bathroom.webp', labelKey: 'furnishTools.bathroom', catalogCategory: 'bathroom' },
  { id: 'item', iconSrc: '/icons/tree.webp', labelKey: 'furnishTools.outdoor', catalogCategory: 'outdoor' },
]
import type { CatalogCategory } from './../../../store/use-editor'

export type FurnishToolConfig = {
  id: 'item'
  iconSrc: string
  label: string
  catalogCategory: CatalogCategory
}

export const furnishTools: FurnishToolConfig[] = [
  { id: 'item', iconSrc: '/icons/couch.webp', label: 'Furniture', catalogCategory: 'furniture' },
  { id: 'item', iconSrc: '/icons/appliance.webp', label: 'Appliance', catalogCategory: 'appliance' },
  { id: 'item', iconSrc: '/icons/kitchen.webp', label: 'Kitchen', catalogCategory: 'kitchen' },
  { id: 'item', iconSrc: '/icons/bathroom.webp', label: 'Bathroom', catalogCategory: 'bathroom' },
  { id: 'item', iconSrc: '/icons/tree.webp', label: 'Outdoor', catalogCategory: 'outdoor' },
]

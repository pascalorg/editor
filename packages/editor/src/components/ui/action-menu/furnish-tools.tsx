import type { MessageDescriptor } from '@pascal-app/core'
import type { CatalogCategory } from './../../../store/use-editor'

export type FurnishToolConfig = {
  id: 'item'
  iconSrc: string
  label: MessageDescriptor
  catalogCategory: CatalogCategory
}

export const furnishTools: FurnishToolConfig[] = [
  { id: 'item', iconSrc: '/icons/couch.webp', label: /* i18n */ { id: 'editor.actionMenu.furnishTools.furniture', message: 'Furniture' }, catalogCategory: 'furniture' },
  { id: 'item', iconSrc: '/icons/appliance.webp', label: /* i18n */ { id: 'editor.actionMenu.furnishTools.appliance', message: 'Appliance' }, catalogCategory: 'appliance' },
  { id: 'item', iconSrc: '/icons/kitchen.webp', label: /* i18n */ { id: 'editor.actionMenu.furnishTools.kitchen', message: 'Kitchen' }, catalogCategory: 'kitchen' },
  { id: 'item', iconSrc: '/icons/bathroom.webp', label: /* i18n */ { id: 'editor.actionMenu.furnishTools.bathroom', message: 'Bathroom' }, catalogCategory: 'bathroom' },
  { id: 'item', iconSrc: '/icons/tree.webp', label: /* i18n */ { id: 'editor.actionMenu.furnishTools.outdoor', message: 'Outdoor' }, catalogCategory: 'outdoor' },
]

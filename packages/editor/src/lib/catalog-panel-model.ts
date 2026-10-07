import { useViewer } from '@pascal-app/viewer'
import { CATALOG_ITEMS, type CatalogItem } from '../components/ui/item-catalog/catalog-items'
import useEditor, { type CatalogCategory } from '../store/use-editor'

export function filterCatalogItems({
  category,
  items = CATALOG_ITEMS,
  search = '',
  activePlacementTag,
  activeFunctionalTag,
  overrideItems,
}: {
  category?: CatalogCategory
  items?: readonly CatalogItem[]
  search?: string
  activePlacementTag?: string | null
  activeFunctionalTag?: string | null
  overrideItems?: readonly CatalogItem[]
}): readonly CatalogItem[] {
  return (
    overrideItems ??
    items.filter((item) => {
      if (!search && category && item.category !== category) return false
      if (activePlacementTag && !item.tags?.includes(activePlacementTag)) return false
      if (activeFunctionalTag && !item.tags?.includes(activeFunctionalTag)) return false
      return !search || item.name.toLowerCase().includes(search.toLowerCase())
    })
  )
}

export function activateCatalogItem(item: CatalogItem) {
  useViewer.getState().setSelection({ selectedIds: [], zoneId: null })
  const editor = useEditor.getState()
  editor.setSelectedItem(item)
  editor.setTool(item.tool ?? 'item')
  editor.setMode('build')
}

export { isCatalogItemSelected } from './catalog-selection'

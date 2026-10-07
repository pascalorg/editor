import type { CatalogItem } from '../components/ui/item-catalog/catalog-items'

export function isCatalogItemSelected(
  item: Pick<CatalogItem, 'id'>,
  selected: Pick<CatalogItem, 'id'> | null,
) {
  return selected != null && item.id === selected.id
}

'use client'

import type { AssetInput } from '@pascal-app/core'
import { resolveCdnUrl } from '@pascal-app/viewer'
import { useEffect } from 'react'
import { triggerSFX } from './../../../lib/sfx-bus'
import { cn } from './../../../lib/utils'
import useEditor, { type CatalogCategory } from './../../../store/use-editor'
import { resolveAssetSnapTarget, SnapTargetBadge } from '../snap-target-badge'
import { activateCatalogItem, filterCatalogItems, isCatalogItemSelected } from '../../../lib/catalog-panel-model'

export function ItemCatalog({
  category,
  items: itemsOverride,
  activePlacementTag = null,
  activeFunctionalTag = null,
  search = '',
  overrideItems,
  leadingTile,
  emptyState,
}: {
  category: CatalogCategory
  items?: AssetInput[]
  activePlacementTag?: string | null
  activeFunctionalTag?: string | null
  search?: string
  /** When set, bypasses all filtering and displays these items directly (used for server search results) */
  overrideItems?: AssetInput[]
  /** Rendered as the first grid cell, always visible when there are items. */
  leadingTile?: React.ReactNode
  /** Rendered when there are no items to show. Replaces the empty grid. */
  emptyState?: React.ReactNode
}) {
  const selectedItem = useEditor((state) => state.selectedItem)
  const filteredItems = filterCatalogItems({ category, items: itemsOverride, overrideItems, search, activePlacementTag, activeFunctionalTag })

  if (filteredItems.length === 0 && emptyState) {
    return <>{emptyState}</>
  }

  return (
    <div
      className="grid gap-2"
      style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(90px, 1fr))' }}
    >
      {leadingTile}
      {filteredItems.map((item, index) => {
        const isSelected = isCatalogItemSelected(item, selectedItem)
        const snapTarget = resolveAssetSnapTarget(item?.attachTo)
        return (
          <button
            className={cn(
              'group relative flex flex-col gap-1.5 rounded-xl p-1.5 transition-colors hover:cursor-pointer hover:bg-sidebar-accent',
              isSelected && 'bg-sidebar-accent ring-2 ring-primary-foreground',
            )}
            key={index}
            onClick={() => {
              triggerSFX('sfx:menu-click')
              activateCatalogItem(item)
            }}
            onMouseEnter={() => triggerSFX('sfx:menu-hover')}
            type="button"
          >
            <div className="relative aspect-square w-full overflow-hidden rounded-lg">
              <img
                alt={item.name}
                className="h-full w-full object-cover"
                loading="eager"
                src={resolveCdnUrl(item.thumbnail) || ''}
              />
              {snapTarget && (
                <SnapTargetBadge className="absolute right-1 bottom-1" target={snapTarget} />
              )}
            </div>
            <span className="truncate px-0.5 text-left font-medium text-[11px] text-muted-foreground group-hover:text-foreground">
              {item.name}
            </span>
          </button>
        )
      })}
    </div>
  )
}

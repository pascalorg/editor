'use client'

import type { AssetInput } from '@pascal-app/core'
import { resolveAssetUrl, resolveCdnUrl, useViewer } from '@pascal-app/viewer'
import { useEffect, useState } from 'react'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from './../../../components/ui/primitives/tooltip'
import { triggerSFX } from './../../../lib/sfx-bus'
import { cn } from './../../../lib/utils'
import useEditor, { type CatalogCategory } from './../../../store/use-editor'
import { getAllCatalogItems } from './catalog-items'
import { useCustomCatalog } from './custom-catalog-store'
import { useDevCatalogOverlay } from './dev-catalog-overlay-store'

function CatalogThumbnail({ alt, url }: { alt: string; url: string }) {
  const [resolved, setResolved] = useState<string | null>(() =>
    url.startsWith('asset://') ? null : resolveCdnUrl(url),
  )

  useEffect(() => {
    if (!url.startsWith('asset://')) {
      setResolved(resolveCdnUrl(url))
      return
    }
    let cancelled = false
    void resolveAssetUrl(url).then((next) => {
      if (!cancelled) setResolved(next)
    })
    return () => {
      cancelled = true
    }
  }, [url])

  if (!resolved) {
    return <div className="h-full w-full bg-muted" />
  }

  return (
    <img alt={alt} className="h-full w-full object-cover" loading="eager" src={resolved} />
  )
}

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
  const setSelectedItem = useEditor((state) => state.setSelectedItem)
  const setMode = useEditor((state) => state.setMode)
  const setTool = useEditor((state) => state.setTool)
  const customCatalogRevision = useCustomCatalog((state) => state.customItems)
  const devOverlayRevision = useDevCatalogOverlay((state) => state.revision)

  const sourceItems = itemsOverride ?? getAllCatalogItems()
  void customCatalogRevision
  void devOverlayRevision
  // Server-provided results bypass all local filtering; otherwise filter by category/search/tags
  const filteredItems =
    overrideItems ??
    (() => {
      const categoryItems = search
        ? sourceItems
        : sourceItems.filter((item) => item.category === category)
      return categoryItems.filter((item) => {
        const tags = item.tags ?? []
        if (activePlacementTag && !tags.includes(activePlacementTag)) return false
        if (activeFunctionalTag && !tags.includes(activeFunctionalTag)) return false
        if (search && !item.name.toLowerCase().includes(search.toLowerCase())) return false
        return true
      })
    })()

  const categoryItems = filteredItems

  // Auto-select first item if current selection is not in the filtered list
  useEffect(() => {
    const isCurrentItemInCategory = categoryItems.some((item) => item.src === selectedItem?.src)
    if (!isCurrentItemInCategory && categoryItems.length > 0) {
      setSelectedItem(categoryItems[0] as AssetInput)
    }
  }, [categoryItems, selectedItem?.src, setSelectedItem])

  const getAttachmentIcon = (attachTo: AssetInput['attachTo']) => {
    if (attachTo === 'wall' || attachTo === 'wall-side') return '/icons/wall.png'
    if (attachTo === 'ceiling') return '/icons/ceiling.png'
    return null
  }

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
        const isSelected = selectedItem?.src === item?.src
        const attachmentIcon = getAttachmentIcon(item?.attachTo)
        return (
          <button
            className={cn(
              'group relative flex flex-col gap-1.5 rounded-xl p-1.5 transition-colors hover:cursor-pointer hover:bg-sidebar-accent',
              isSelected && 'bg-sidebar-accent ring-2 ring-primary-foreground',
            )}
            key={item.id}
            onClick={() => {
              triggerSFX('sfx:menu-click')
              // Drop the current selection before arming placement — keeping
              // it would route shortcuts (rotate & co) to both the ghost and
              // the selected node.
              useViewer.getState().setSelection({ selectedIds: [], zoneId: null })
              setSelectedItem(item)
              setTool('item')
              setMode('build')
            }}
            onMouseEnter={() => triggerSFX('sfx:menu-hover')}
            type="button"
          >
            <div className="relative aspect-square w-full overflow-hidden rounded-lg">
              <CatalogThumbnail alt={item.name} url={item.thumbnail} />
              {attachmentIcon && (
                <div className="absolute right-1 bottom-1 flex h-4 w-4 items-center justify-center rounded bg-black/60">
                  <img
                    alt={item.attachTo === 'ceiling' ? 'Ceiling attachment' : 'Wall attachment'}
                    className="h-4 w-4"
                    src={attachmentIcon}
                  />
                </div>
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

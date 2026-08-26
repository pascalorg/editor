'use client'

import { Icon } from '@iconify/react'
import type { AssetInput, IconRef } from '@pascal-app/core'
import { resolveCdnUrl, useViewer } from '@pascal-app/viewer'
import type React from 'react'
import { triggerSFX } from './../../../lib/sfx-bus'
import { cn } from './../../../lib/utils'
import useEditor, { type CatalogCategory } from './../../../store/use-editor'
import { IconRefGlyph } from '../icon-ref'
import { resolveAssetSnapTarget, SnapTargetBadge } from '../snap-target-badge'
import { CATALOG_ITEMS, type CatalogItem } from './catalog-items'

export type ItemCatalogItem = Partial<AssetInput> & {
  id?: string
  name?: string
  label?: string
  category?: string
  sectionId?: string
  thumbnail?: string
  icon?: string | IconRef
  tool?: string
  kind?: string
  tags?: string[]
  description?: string
  isSelected?: boolean
  onClick?: () => void
  onSelect?: () => void
  [key: string]: unknown
}

export interface ItemCatalogProps {
  category?: CatalogCategory | string
  items?: (AssetInput | ItemCatalogItem)[]
  activePlacementTag?: string | null
  activeFunctionalTag?: string | null
  search?: string
  /** When set, bypasses all filtering and displays these items directly (used for server search results or custom views) */
  overrideItems?: (AssetInput | ItemCatalogItem)[]
  /** Rendered as the first grid cell, always visible when there are items. */
  leadingTile?: React.ReactNode
  /** Rendered when there are no items to show. Replaces the empty grid. */
  emptyState?: React.ReactNode
  /** Optional click delegate. When supplied, overrides default editor item selection and tool arming. */
  onItemClick?: (item: ItemCatalogItem) => void
  /** Optional predicate to determine whether an item card has active/armed styling. */
  isItemActive?: (item: ItemCatalogItem) => boolean
  /** Optional custom container class name */
  className?: string
}

function isIconifyString(value?: string | null): boolean {
  if (!value || typeof value !== 'string') return false
  const trimmed = value.trim()
  if (
    trimmed.startsWith('http://') ||
    trimmed.startsWith('https://') ||
    trimmed.startsWith('/') ||
    trimmed.startsWith('./') ||
    trimmed.startsWith('../') ||
    trimmed.startsWith('data:') ||
    trimmed.startsWith('blob:')
  ) {
    return false
  }
  return trimmed.includes(':') || !trimmed.includes('.')
}

function renderItemMedia(item: ItemCatalogItem, displayName: string) {
  // 1. Explicit icon property
  if (item.icon) {
    if (typeof item.icon === 'string') {
      if (isIconifyString(item.icon)) {
        return (
          <Icon
            className="size-7 text-foreground/80 transition-transform duration-200 group-hover:scale-110 group-hover:text-foreground"
            height={28}
            icon={item.icon}
            width={28}
          />
        )
      }
      return (
        <img
          alt={displayName}
          className="h-full w-full object-cover p-1"
          loading="eager"
          src={resolveCdnUrl(item.icon) || item.icon}
        />
      )
    }
    if (typeof item.icon === 'object') {
      return <IconRefGlyph icon={item.icon} size={28} />
    }
  }

  // 2. Thumbnail property (either an Iconify icon string or image URL)
  if (item.thumbnail) {
    if (isIconifyString(item.thumbnail)) {
      return (
        <Icon
          className="size-7 text-foreground/80 transition-transform duration-200 group-hover:scale-110 group-hover:text-foreground"
          height={28}
          icon={item.thumbnail}
          width={28}
        />
      )
    }
    return (
      <img
        alt={displayName}
        className="h-full w-full object-cover"
        loading="eager"
        src={resolveCdnUrl(item.thumbnail) || item.thumbnail}
      />
    )
  }

  // 3. Fallback placeholder icon
  return (
    <Icon
      className="size-7 text-muted-foreground/60 transition-transform duration-200 group-hover:scale-110 group-hover:text-foreground"
      height={28}
      icon="lucide:box"
      width={28}
    />
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
  onItemClick,
  isItemActive,
  className,
}: ItemCatalogProps) {
  const selectedItem = useEditor((state) => state.selectedItem)
  const setSelectedItem = useEditor((state) => state.setSelectedItem)
  const setMode = useEditor((state) => state.setMode)
  const setTool = useEditor((state) => state.setTool)

  const sourceItems: ItemCatalogItem[] = (itemsOverride ?? CATALOG_ITEMS) as ItemCatalogItem[]

  // Server-provided or pre-filtered results bypass all local filtering; otherwise filter by category/search/tags
  const filteredItems: ItemCatalogItem[] =
    (overrideItems as ItemCatalogItem[]) ??
    (() => {
      const categoryItems =
        search || !category
          ? sourceItems
          : sourceItems.filter(
              (item) => item.category === category || item.sectionId === category,
            )
      return categoryItems.filter((item) => {
        const tags = item.tags ?? []
        if (activePlacementTag && !tags.includes(activePlacementTag)) return false
        if (activeFunctionalTag && !tags.includes(activeFunctionalTag)) return false
        if (search) {
          const query = search.toLowerCase()
          const name = (item.name ?? item.label ?? '').toLowerCase()
          const tagsList = tags.map((t) => t.toLowerCase())
          const description = (item.description ?? '').toLowerCase()
          const id = (item.id ?? '').toLowerCase()
          const matches =
            name.includes(query) ||
            tagsList.some((t) => t.includes(query)) ||
            description.includes(query) ||
            id.includes(query)
          if (!matches) return false
        }
        return true
      })
    })()

  if (filteredItems.length === 0 && emptyState) {
    return <>{emptyState}</>
  }

  return (
    <div
      className={cn('grid gap-2', className)}
      style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(90px, 1fr))' }}
    >
      {leadingTile}
      {filteredItems.map((item, index) => {
        const displayName = item.name ?? item.label ?? item.id ?? ''
        const isSelected = isItemActive
          ? isItemActive(item)
          : (item.isSelected ??
            (selectedItem?.src && item?.src
              ? selectedItem.src === item.src
              : selectedItem?.id && item?.id
                ? selectedItem.id === item.id
                : false))
        const snapTarget = resolveAssetSnapTarget(item?.attachTo)

        const handleClick = () => {
          triggerSFX('sfx:menu-click')
          if (onItemClick) {
            onItemClick(item)
            return
          }
          if (item.onClick) {
            item.onClick()
            return
          }
          // Default host placement workflow:
          // Drop current selection before arming placement
          useViewer.getState().setSelection({ selectedIds: [], zoneId: null })
          setSelectedItem(item as CatalogItem)
          setTool((item.tool ?? item.kind ?? 'item') as never)
          setMode('build')
        }

        return (
          <button
            aria-pressed={isSelected}
            className={cn(
              'group relative flex flex-col gap-1.5 rounded-xl p-1.5 transition-colors hover:cursor-pointer hover:bg-sidebar-accent',
              isSelected && 'bg-sidebar-accent ring-2 ring-primary-foreground',
            )}
            data-item-id={item.id}
            key={item.id ?? index}
            onClick={handleClick}
            onMouseEnter={() => triggerSFX('sfx:menu-hover')}
            title={item.description ?? displayName}
            type="button"
          >
            <div className="relative flex aspect-square w-full items-center justify-center overflow-hidden rounded-lg bg-muted/40">
              {renderItemMedia(item, displayName)}
              {snapTarget && (
                <SnapTargetBadge className="absolute right-1 bottom-1" target={snapTarget} />
              )}
            </div>
            <span className="truncate px-0.5 text-left font-medium text-[11px] text-muted-foreground group-hover:text-foreground">
              {displayName}
            </span>
          </button>
        )
      })}
    </div>
  )
}


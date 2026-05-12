'use client'

import type { AssetInput } from '@pascal-app/core'
import NextImage from 'next/image'
import { useEffect, useState } from 'react'
import { cn } from '../../../../../lib/utils'
import type { CatalogCategory } from '../../../../../store/use-editor'
import useEditor from '../../../../../store/use-editor'
import { furnishTools } from '../../../action-menu/furnish-tools'
import { CATALOG_ITEMS } from '../../../item-catalog/catalog-items'
import { ItemCatalog } from '../../../item-catalog/item-catalog'

const PLACEMENT_TAGS = new Set(['floor', 'wall', 'ceiling', 'countertop'])

export function ItemsPanel({
  items,
  onSearchChange,
  searchResults,
  leadingTile,
  emptyState,
}: {
  items?: AssetInput[]
  /** Called when the search query changes (community edition uses this for server-side search) */
  onSearchChange?: (query: string) => void
  /** When non-null and search is active, these results bypass local filtering (server search results) */
  searchResults?: AssetInput[] | null
  /**
   * Optional node rendered as the first grid cell, always visible. Used by the
   * community edition to inject a "+ Generate with AI" tile.
   */
  leadingTile?: React.ReactNode
  /**
   * Optional node rendered when the grid has no items to show (empty category
   * or no search results). Replaces the default "No results" message.
   */
  emptyState?: React.ReactNode
}) {
  const mode = useEditor((s) => s.mode)
  const catalogCategory = useEditor((s) => s.catalogCategory)
  const setMode = useEditor((s) => s.setMode)
  const setTool = useEditor((s) => s.setTool)
  const setCatalogCategory = useEditor((s) => s.setCatalogCategory)

  const [activePlacementTag, setActivePlacementTag] = useState<string | null>(null)
  const [activeFunctionalTag, setActiveFunctionalTag] = useState<string | null>(null)
  // Library / Community / Mine. Default to Library so first-time users see
  // the curated catalog rather than every uploaded item; clicking the chip
  // again clears the filter (`null` = show everything).
  const [activeSource, setActiveSource] = useState<AssetInput['source'] | null>('library')
  const [search, setSearch] = useState('')
  const isServerSearch = onSearchChange !== undefined
  // True when server search is active but results haven't come back yet
  const isSearchPending = isServerSearch && search.length > 0 && searchResults === null

  // Auto-select the first category when the panel mounts without one
  useEffect(() => {
    if (!(catalogCategory && furnishTools.some((c) => c.catalogCategory === catalogCategory))) {
      setCatalogCategory(furnishTools[0]!.catalogCategory)
    }
  }, [catalogCategory, setCatalogCategory])

  const activeCategory =
    furnishTools.find((c) => c.catalogCategory === catalogCategory) ?? furnishTools[0]!

  function selectCategory(categoryId: CatalogCategory) {
    setCatalogCategory(categoryId)
    setTool('item')
    setActivePlacementTag(null)
    setActiveFunctionalTag(null)
    setSearch('')
    if (mode !== 'build') setMode('build')
  }

  // Compute tags for the current category (for filter chips)
  const baseItems = items ?? CATALOG_ITEMS
  // Apply the Library/Community/Mine filter before any category/tag work.
  // Items that don't carry a source field (e.g. seeded built-in catalog
  // entries from `CATALOG_ITEMS`) fall under "library".
  //
  // Community is broader than just other users' uploads: my own *published*
  // items show up there too so I can preview my catalog the way other users
  // see it. My drafts only appear under Mine.
  const matchesSource = (item: AssetInput) => {
    if (!activeSource) return true
    const itemSource = item.source ?? 'library'
    if (activeSource === 'mine') return itemSource === 'mine'
    if (activeSource === 'library') return itemSource === 'library'
    if (activeSource === 'community') {
      if (itemSource === 'community') return true
      if (itemSource === 'mine') return !item.isDraft
      return false
    }
    return true
  }
  const sourceItems = baseItems.filter(matchesSource)
  const categoryItems = sourceItems.filter(
    (item) => item.category === activeCategory.catalogCategory,
  )

  // The three source chips are always shown so users can discover the
  // filter even before they own any items. Selecting "Mine" with no
  // matching items falls through to the empty/no-results state.
  const sourceChips: Array<{ id: AssetInput['source']; label: string }> = [
    { id: 'library', label: 'Library' },
    { id: 'community', label: 'Community' },
    { id: 'mine', label: 'Mine' },
  ]
  const allTags = Array.from(new Set(categoryItems.flatMap((item) => item.tags ?? [])))
  const placementTags = allTags.filter((t) => PLACEMENT_TAGS.has(t))
  const functionalTags = allTags.filter((t) => !PLACEMENT_TAGS.has(t))
  const hasFilters = allTags.length > 1

  const placementCount = (tag: string | null) =>
    categoryItems.filter((item) => {
      const tags = item.tags ?? []
      if (tag !== null && !tags.includes(tag)) return false
      if (activeFunctionalTag && !tags.includes(activeFunctionalTag)) return false
      return true
    }).length

  const functionalCount = (tag: string) =>
    categoryItems.filter((item) => {
      const tags = item.tags ?? []
      if (!tags.includes(tag)) return false
      if (activePlacementTag && !tags.includes(activePlacementTag)) return false
      return true
    }).length

  return (
    <div className="flex h-full flex-col">
      {/* Category tabs */}
      <div className="flex shrink-0 gap-1 overflow-x-auto border-border/70 border-b p-2">
        {furnishTools.map((cat) => {
          const isActive = activeCategory.catalogCategory === cat.catalogCategory
          return (
            <button
              className={cn(
                'flex shrink-0 flex-col items-center gap-1 rounded-xl px-3 py-2 transition-colors',
                isActive
                  ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                  : 'text-muted-foreground hover:bg-sidebar-accent/50 hover:text-foreground',
              )}
              key={cat.catalogCategory}
              onClick={() => selectCategory(cat.catalogCategory)}
              type="button"
            >
              <NextImage
                alt={cat.label}
                className={cn('size-7 object-contain', !isActive && 'opacity-60 grayscale')}
                height={28}
                src={cat.iconSrc}
                width={28}
              />
              <span className="font-medium text-[10px] leading-none">{cat.label}</span>
            </button>
          )
        })}
      </div>

      {/* Search + filters (non-scrollable) */}
      <div className="flex shrink-0 flex-col gap-2 border-border/70 border-b p-2">
        <div className="flex items-center gap-1.5">
          {/* Search and source filter take 50/50 of the row. `min-w-0` on
              both sides lets each half shrink to fit when the panel narrows. */}
          <input
            className="w-1/2 min-w-0 shrink-0 rounded-lg bg-muted px-2.5 py-1.5 text-xs placeholder:text-muted-foreground focus:outline-none"
            onChange={(e) => {
              setSearch(e.target.value)
              onSearchChange?.(e.target.value)
            }}
            placeholder="Search..."
            type="text"
            value={search}
          />
          {sourceChips.length > 0 && (
            <div className="flex w-1/2 min-w-0 shrink-0 rounded-lg bg-muted p-0.5">
              {sourceChips.map((chip) => {
                const isActive = activeSource === chip.id
                return (
                  <button
                    className={cn(
                      'min-w-0 flex-1 truncate rounded-md px-1 py-1 text-center font-medium text-[10px] transition-colors',
                      isActive
                        ? 'bg-background text-foreground shadow-sm'
                        : 'text-muted-foreground hover:text-foreground',
                    )}
                    key={chip.id}
                    onClick={() => setActiveSource(isActive ? null : chip.id)}
                    type="button"
                  >
                    {chip.label}
                  </button>
                )
              })}
            </div>
          )}
        </div>

        {hasFilters && !search && !isServerSearch && (
          <div className="flex flex-col gap-1.5">
            {placementTags.length > 0 && (
              <div className="flex flex-wrap gap-1">
                <button
                  className={cn(
                    'cursor-pointer rounded-md px-2 py-0.5 font-medium text-xs transition-colors',
                    activePlacementTag === null
                      ? 'bg-blue-500 text-white'
                      : 'bg-blue-950/50 text-blue-300 hover:bg-blue-900/60 hover:text-blue-200',
                  )}
                  onClick={() => setActivePlacementTag(null)}
                  type="button"
                >
                  All
                </button>
                {placementTags.map((tag) => {
                  const count = placementCount(tag)
                  const isActive = activePlacementTag === tag
                  const isEmpty = count === 0 && !isActive
                  return (
                    <button
                      className={cn(
                        'inline-flex cursor-pointer items-center gap-1 rounded-md py-0.5 pr-1.5 pl-2 font-medium text-xs capitalize transition-colors',
                        isActive
                          ? 'bg-blue-500 text-white'
                          : isEmpty
                            ? 'cursor-not-allowed bg-zinc-800 text-zinc-500'
                            : 'bg-blue-950/50 text-blue-300 hover:bg-blue-900/60 hover:text-blue-200',
                      )}
                      disabled={isEmpty}
                      key={tag}
                      onClick={() => setActivePlacementTag(isActive ? null : tag)}
                      type="button"
                    >
                      {tag}
                      <span
                        className={cn(
                          'text-[10px]',
                          isActive
                            ? 'text-blue-200'
                            : isEmpty
                              ? 'text-zinc-600'
                              : 'text-blue-500/70',
                        )}
                      >
                        {count}
                      </span>
                    </button>
                  )
                })}
              </div>
            )}

            {functionalTags.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {functionalTags.map((tag) => {
                  const count = functionalCount(tag)
                  const isActive = activeFunctionalTag === tag
                  const isEmpty = count === 0 && !isActive
                  return (
                    <button
                      className={cn(
                        'inline-flex cursor-pointer items-center gap-1 rounded-md py-0.5 pr-1.5 pl-2 font-medium text-xs capitalize transition-colors',
                        isActive
                          ? 'bg-violet-500 text-white'
                          : isEmpty
                            ? 'cursor-not-allowed bg-zinc-800 text-zinc-500'
                            : 'bg-muted text-muted-foreground hover:bg-muted/80 hover:text-foreground',
                      )}
                      disabled={isEmpty}
                      key={tag}
                      onClick={() => setActiveFunctionalTag(isActive ? null : tag)}
                      type="button"
                    >
                      {tag}
                      <span
                        className={cn(
                          'text-[10px]',
                          isActive
                            ? 'text-violet-200'
                            : isEmpty
                              ? 'text-zinc-600'
                              : 'text-zinc-500/70',
                        )}
                      >
                        {count}
                      </span>
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Item grid */}
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {isSearchPending ? (
          <div className="flex h-full items-center justify-center">
            <div className="size-5 animate-spin rounded-full border-2 border-muted-foreground/20 border-t-muted-foreground" />
          </div>
        ) : isServerSearch && search && searchResults?.length === 0 ? (
          (emptyState ?? (
            <div className="flex h-full items-center justify-center text-muted-foreground text-xs">
              No results for &ldquo;{search}&rdquo;
            </div>
          ))
        ) : (
          <ItemCatalog
            activeFunctionalTag={isServerSearch ? null : activeFunctionalTag}
            activePlacementTag={isServerSearch ? null : activePlacementTag}
            category={activeCategory.catalogCategory}
            emptyState={emptyState}
            items={activeSource && items ? items.filter(matchesSource) : items}
            key={activeCategory.catalogCategory}
            leadingTile={leadingTile}
            overrideItems={
              isServerSearch && search
                ? activeSource && searchResults
                  ? searchResults.filter(matchesSource)
                  : (searchResults ?? undefined)
                : undefined
            }
            search={isServerSearch ? '' : search}
          />
        )}
      </div>
    </div>
  )
}

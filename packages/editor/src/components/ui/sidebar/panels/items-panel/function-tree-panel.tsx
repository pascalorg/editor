'use client'

import type { AssetInput } from '@pascal-app/core'
import { Root as TooltipRoot } from '@radix-ui/react-tooltip'
import NextImage from 'next/image'
import { useMemo, useState } from 'react'
import { triggerSFX } from '../../../../../lib/sfx-bus'
import { cn } from '../../../../../lib/utils'
import { ItemCatalog } from '../../../item-catalog/item-catalog'
import {
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '../../../../../components/ui/primitives/tooltip'

/** A function-axis taxonomy node, assembled into a tree by the embedder. */
export type FunctionTreeNode = {
  slug: string
  name: string
  iconUrl?: string | null
  children: FunctionTreeNode[]
}

const SOURCE_CHIPS: Array<{ id: NonNullable<AssetInput['source']>; label: string }> = [
  { id: 'library', label: 'Library' },
  { id: 'community', label: 'Community' },
  { id: 'mine', label: 'Mine' },
]

/** Every slug at or below `node`, so a non-leaf selection matches descendants. */
function descendantSlugs(node: FunctionTreeNode): Set<string> {
  const out = new Set<string>()
  const walk = (n: FunctionTreeNode) => {
    out.add(n.slug)
    for (const child of n.children) walk(child)
  }
  walk(node)
  return out
}

function itemFunctionSlugs(item: AssetInput): string[] {
  if (item.functionTags && item.functionTags.length > 0) return item.functionTags
  return item.category ? [item.category] : []
}

/**
 * DB-driven hierarchical Items browse. Roots render as the category tab bar;
 * a selected root with children exposes those children as a secondary chip
 * row. Selecting any node shows items tagged with that node or any descendant.
 * Library / Community / Mine narrows by source on top of the tree selection.
 */
export function FunctionTreePanel({
  functionTree,
  items,
  onSearchChange,
  searchResults,
  leadingTile,
  emptyState,
}: {
  functionTree: FunctionTreeNode[]
  items?: AssetInput[]
  onSearchChange?: (query: string) => void
  searchResults?: AssetInput[] | null
  leadingTile?: React.ReactNode
  emptyState?: React.ReactNode
}) {
  const [activeRootSlug, setActiveRootSlug] = useState<string | null>(
    functionTree[0]?.slug ?? null,
  )
  const [activeChildSlug, setActiveChildSlug] = useState<string | null>(null)
  const [activeSource, setActiveSource] = useState<AssetInput['source'] | null>('library')
  const [search, setSearch] = useState('')

  const isServerSearch = onSearchChange !== undefined
  const isSearchPending = isServerSearch && search.length > 0 && searchResults === null

  const activeRoot = functionTree.find((n) => n.slug === activeRootSlug) ?? functionTree[0]
  const activeNode =
    (activeChildSlug && activeRoot?.children.find((c) => c.slug === activeChildSlug)) || activeRoot

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

  const treeItems = useMemo(() => {
    const base = items ?? []
    if (!activeNode) return base.filter(matchesSource)
    const slugs = descendantSlugs(activeNode)
    return base.filter(
      (item) => matchesSource(item) && itemFunctionSlugs(item).some((s) => slugs.has(s)),
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, activeNode, activeSource])

  const searchItems = useMemo(() => {
    if (!(isServerSearch && search && searchResults)) return null
    return activeSource ? searchResults.filter(matchesSource) : searchResults
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isServerSearch, search, searchResults, activeSource])

  function selectRoot(slug: string) {
    setActiveRootSlug(slug)
    setActiveChildSlug(null)
    setSearch('')
    onSearchChange?.('')
  }

  return (
    <div className="flex h-full flex-col">
      {/* Root nodes as a category grid — icon when available, otherwise a
          two-letter abbreviation, with the full name in a hover tooltip.
          Mirrors the Build tab's tile grid so the two panels read the same. */}
      <TooltipProvider delayDuration={0} disableHoverableContent>
        <div className="grid shrink-0 grid-cols-5 gap-1.5 border-border/70 border-b p-2">
          {functionTree.map((root) => {
            const isActive = activeRoot?.slug === root.slug
            return (
              <TooltipRoot key={root.slug}>
                <TooltipTrigger asChild>
                  <button
                    className={cn(
                      'relative flex aspect-square items-center justify-center rounded-xl transition-all duration-200',
                      isActive
                        ? 'bg-primary/10 ring-1 ring-primary/50'
                        : 'bg-muted/40 opacity-70 grayscale hover:bg-muted hover:opacity-100 hover:grayscale-0',
                    )}
                    onClick={() => {
                      triggerSFX('sfx:menu-click')
                      selectRoot(root.slug)
                    }}
                    onMouseEnter={() => triggerSFX('sfx:menu-hover')}
                    type="button"
                  >
                    {root.iconUrl ? (
                      <NextImage
                        alt={root.name}
                        className="size-7 object-contain"
                        height={28}
                        src={root.iconUrl}
                        width={28}
                      />
                    ) : (
                      <span className="font-semibold text-muted-foreground text-xs uppercase">
                        {root.name.slice(0, 2)}
                      </span>
                    )}
                  </button>
                </TooltipTrigger>
                <TooltipContent className="icon-grid-tooltip pointer-events-none" side="top">
                  {root.name}
                </TooltipContent>
              </TooltipRoot>
            )
          })}
        </div>
      </TooltipProvider>

      {/* Search + source filter */}
      <div className="flex shrink-0 flex-col gap-2 border-border/70 border-b p-2">
        <div className="flex items-center gap-1.5">
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
          <div className="flex w-1/2 min-w-0 shrink-0 rounded-lg bg-muted p-0.5">
            {SOURCE_CHIPS.map((chip) => {
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
        </div>

        {/* Child nodes of the active root as a secondary chip row */}
        {!search && activeRoot && activeRoot.children.length > 0 && (
          <div className="flex flex-wrap gap-1">
            <button
              className={cn(
                'cursor-pointer rounded-md px-2 py-0.5 font-medium text-xs transition-colors',
                activeChildSlug === null
                  ? 'bg-violet-500 text-white'
                  : 'bg-muted text-muted-foreground hover:bg-muted/80 hover:text-foreground',
              )}
              onClick={() => setActiveChildSlug(null)}
              type="button"
            >
              All
            </button>
            {activeRoot.children.map((child) => {
              const isActive = activeChildSlug === child.slug
              return (
                <button
                  className={cn(
                    'cursor-pointer rounded-md px-2 py-0.5 font-medium text-xs capitalize transition-colors',
                    isActive
                      ? 'bg-violet-500 text-white'
                      : 'bg-muted text-muted-foreground hover:bg-muted/80 hover:text-foreground',
                  )}
                  key={child.slug}
                  onClick={() => setActiveChildSlug(isActive ? null : child.slug)}
                  type="button"
                >
                  {child.name}
                </button>
              )
            })}
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
            category={'furnish' as never}
            emptyState={emptyState}
            key={activeNode?.slug ?? 'all'}
            leadingTile={leadingTile}
            overrideItems={isServerSearch && search ? (searchItems ?? undefined) : treeItems}
          />
        )}
      </div>
    </div>
  )
}

'use client'

import type { AssetInput } from '@pascal-app/core'
import { Icon } from '@iconify/react'
import NextImage from 'next/image'
import { useEffect, useRef, useState } from 'react'
import { cn } from '../../../../../lib/utils'
import { t } from '../../../../../i18n'
import {
  type GeneratedGeometryArtifact,
  placeGeneratedGeometryArtifact,
  readSavedGeneratedGeometryArtifacts,
  removeGeneratedGeometryArtifactFromLocalLibrary,
} from '../../../../../lib/ai-generated-geometry'
import type { CatalogCategory } from '../../../../../store/use-editor'
import useEditor from '../../../../../store/use-editor'
import { furnishTools, getFurnishToolLabel } from '../../../action-menu/furnish-tools'
import { CATALOG_ITEMS } from '../../../item-catalog/catalog-items'
import { ItemCatalog } from '../../../item-catalog/item-catalog'

const PLACEMENT_TAGS = new Set(['floor', 'wall', 'ceiling', 'countertop'])
const IMPORTED_ASSETS_UPDATED_EVENT = 'imported-assets:updated'

function itemMatchesCatalogCategory(item: AssetInput, category: CatalogCategory) {
  if (category === 'mine') return (item.source ?? 'library') === 'mine'
  return (
    item.category === category ||
    ((item.category === 'electrical' || item.category === 'hvac') && category === 'electronics') ||
    (item.category === 'infrastructure' && category === 'outdoor') ||
    (item.category === 'nature' && category === 'outdoor') ||
    (item.category === 'vehicle' && category === 'outdoor')
  )
}

function matchesGeneratedGeometrySearch(artifact: GeneratedGeometryArtifact, query: string) {
  const normalized = query.trim().toLowerCase()
  if (!normalized) return true
  return [artifact.title, artifact.userPrompt, artifact.sourceTool, artifact.shapeDetails]
    .some((value) => value.toLowerCase().includes(normalized))
}


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
  const setSelectedItem = useEditor((s) => s.setSelectedItem)

  const [activePlacementTag, setActivePlacementTag] = useState<string | null>(null)
  const [activeFunctionalTag, setActiveFunctionalTag] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [generatedItems, setGeneratedItems] = useState<AssetInput[]>([])
  const [generatedGeometryArtifacts, setGeneratedGeometryArtifacts] = useState<GeneratedGeometryArtifact[]>([])
  const [glbImporting, setGlbImporting] = useState(false)
  const [glbImportError, setGlbImportError] = useState<string | null>(null)
  const glbInputRef = useRef<HTMLInputElement>(null)
  const isServerSearch = onSearchChange !== undefined

  // Auto-select the first category when the panel mounts without one
  useEffect(() => {
    if (!(catalogCategory && furnishTools.some((c) => c.catalogCategory === catalogCategory))) {
      setCatalogCategory(furnishTools[0]!.catalogCategory)
    }
  }, [catalogCategory, setCatalogCategory])

  const activeCategory =
    furnishTools.find((c) => c.catalogCategory === catalogCategory) ?? furnishTools[0]!
  const isMineCategory = activeCategory.catalogCategory === 'mine'
  // True when server search is active but results haven't come back yet
  const isSearchPending =
    !isMineCategory && isServerSearch && search.length > 0 && searchResults === null

  async function handleGlbSelected(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0]
    event.currentTarget.value = ''
    if (!file) return
    if (!file.name.toLowerCase().endsWith('.glb')) {
      setGlbImportError('请选择 .glb 文件')
      return
    }

    setGlbImporting(true)
    setGlbImportError(null)
    try {
      const form = new FormData()
      form.set('model', file)
      form.set('name', file.name.replace(/\.glb$/i, ''))
      form.set('category', isMineCategory ? 'equipment' : activeCategory.catalogCategory)
      const res = await fetch('/api/imported-glb/assets', {
        method: 'POST',
        body: form,
      })
      const data = (await res.json().catch(() => ({}))) as { asset?: AssetInput; error?: string }
      if (!res.ok || !data.asset) {
        throw new Error(data.error || `导入失败 (${res.status})`)
      }

      setGeneratedItems((prev) => [
        data.asset!,
        ...prev.filter((item) => item.id !== data.asset!.id),
      ])
      setSelectedItem(data.asset)
      setCatalogCategory('mine')
      setActivePlacementTag(null)
      setActiveFunctionalTag(null)
      setSearch('')
      setTool('item')
      if (mode !== 'build') setMode('build')
      window.dispatchEvent(new Event(IMPORTED_ASSETS_UPDATED_EVENT))
    } catch (error) {
      setGlbImportError(error instanceof Error ? error.message : String(error))
    } finally {
      setGlbImporting(false)
    }
  }

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const responses = await Promise.allSettled([
          fetch('/api/articraft/assets', { cache: 'no-store' }),
          fetch('/api/imported-glb/assets', { cache: 'no-store' }),
        ])
        const assets: AssetInput[] = []
        for (const response of responses) {
          if (response.status !== 'fulfilled' || !response.value.ok) continue
          const data = (await response.value.json()) as { assets?: AssetInput[] }
          if (Array.isArray(data.assets)) assets.push(...data.assets)
        }
        if (!cancelled) setGeneratedItems(assets)
      } catch {
        if (!cancelled) setGeneratedItems([])
      }
    }

    void load()
    window.addEventListener('articraft:assets-updated', load)
    window.addEventListener('generated-assets:updated', load)
    window.addEventListener(IMPORTED_ASSETS_UPDATED_EVENT, load)
    return () => {
      cancelled = true
      window.removeEventListener('articraft:assets-updated', load)
      window.removeEventListener('generated-assets:updated', load)
      window.removeEventListener(IMPORTED_ASSETS_UPDATED_EVENT, load)
    }
  }, [])

  useEffect(() => {
    const load = () => setGeneratedGeometryArtifacts(readSavedGeneratedGeometryArtifacts())

    load()
    window.addEventListener('ai-geometry-assets:updated', load)
    return () => window.removeEventListener('ai-geometry-assets:updated', load)
  }, [])

  const placeGeneratedGeometryAsset = (artifact: GeneratedGeometryArtifact) => {
    const result = placeGeneratedGeometryArtifact(artifact)
    if (result.nodeIds.length > 0 && mode !== 'build') setMode('build')
  }

  const removeGeneratedGeometryAsset = (artifact: GeneratedGeometryArtifact) => {
    removeGeneratedGeometryArtifactFromLocalLibrary(artifact.id)
    setGeneratedGeometryArtifacts((prev) => prev.filter((item) => item.id !== artifact.id))
  }


  function selectCategory(categoryId: CatalogCategory) {
    setCatalogCategory(categoryId)
    setTool('item')
    setActivePlacementTag(null)
    setActiveFunctionalTag(null)
    setSearch('')
    if (mode !== 'build') setMode('build')
  }

  const catalogItems = items ?? CATALOG_ITEMS
  const nonMineItems = catalogItems.filter((item) => (item.source ?? 'library') !== 'mine')
  const displayItems = isMineCategory ? generatedItems : nonMineItems
  const categoryItems = displayItems.filter((item) =>
    itemMatchesCatalogCategory(item, activeCategory.catalogCategory),
  )

  const aiGeometryArtifacts = isMineCategory
    ? generatedGeometryArtifacts.filter((artifact) => matchesGeneratedGeometrySearch(artifact, search))
    : []

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
                alt={getFurnishToolLabel(cat.catalogCategory)}
                className={cn('size-7 object-contain', !isActive && 'opacity-60 grayscale')}
                height={28}
                src={cat.iconSrc}
                width={28}
              />
              <span className="font-medium text-[10px] leading-none">
                {getFurnishToolLabel(cat.catalogCategory)}
              </span>
            </button>
          )
        })}
      </div>

      {/* Search + filters (non-scrollable) */}
      <div className="flex shrink-0 flex-col gap-2 border-border/70 border-b p-2">
        <div className="flex items-center gap-1.5">
          <input
            className="min-w-0 flex-1 rounded-lg bg-muted px-2.5 py-1.5 text-xs placeholder:text-muted-foreground focus:outline-none"
            onChange={(e) => {
              setSearch(e.target.value)
              if (!isMineCategory) onSearchChange?.(e.target.value)
            }}
            placeholder={t('sidebar.search', 'Search...')}
            type="text"
            value={search}
          />
          <input
            accept=".glb,model/gltf-binary"
            className="hidden"
            disabled={glbImporting}
            onChange={handleGlbSelected}
            ref={glbInputRef}
            type="file"
          />
          <button
            className="shrink-0 rounded-lg border border-border/70 bg-background px-2.5 py-1.5 font-medium text-[10px] text-foreground transition-colors hover:bg-sidebar-accent disabled:cursor-not-allowed disabled:opacity-60"
            disabled={glbImporting}
            onClick={() => glbInputRef.current?.click()}
            type="button"
          >
            {glbImporting ? '导入中...' : '导入 GLB'}
          </button>
        </div>

        {glbImportError ? <div className="text-[10px] text-red-400">{glbImportError}</div> : null}

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
                  {t('sidebar.all', 'All')}
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
        ) : !isMineCategory && isServerSearch && search && searchResults?.length === 0 ? (
          (emptyState ?? (
            <div className="flex h-full items-center justify-center text-muted-foreground text-xs">
              {t('sidebar.noResultsFor', {
                fallback: 'No results for "{query}"',
                params: { query: search },
              })}
            </div>
          ))
        ) : (
          <div className="space-y-3">
            {aiGeometryArtifacts.length > 0 ? (
              <div className="space-y-2">
                <div className="flex items-center justify-between px-0.5 text-[11px] text-muted-foreground">
                  <span>AI 几何体素材</span>
                  <span>{aiGeometryArtifacts.length}</span>
                </div>
                <div
                  className="grid gap-2"
                  style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(96px, 1fr))' }}
                >
                  {aiGeometryArtifacts.map((artifact) => (
                    <AiGeometryAssetCard
                      artifact={artifact}
                      key={artifact.id}
                      onPlace={placeGeneratedGeometryAsset}
                      onRemove={removeGeneratedGeometryAsset}
                    />
                  ))}
                </div>
              </div>
            ) : null}
            <ItemCatalog
              activeFunctionalTag={!isMineCategory && isServerSearch ? null : activeFunctionalTag}
              activePlacementTag={!isMineCategory && isServerSearch ? null : activePlacementTag}
              category={activeCategory.catalogCategory}
              emptyState={aiGeometryArtifacts.length > 0 ? undefined : emptyState}
              items={displayItems}
              key={activeCategory.catalogCategory}
              leadingTile={isMineCategory ? undefined : leadingTile}
              overrideItems={
                !isMineCategory && isServerSearch && search
                  ? searchResults?.filter((item) => (item.source ?? 'library') !== 'mine')
                  : undefined
              }
              search={!isMineCategory && isServerSearch ? '' : search}
            />
          </div>
        )}
      </div>
    </div>
  )
}

function AiGeometryAssetCard({
  artifact,
  onPlace,
  onRemove,
}: {
  artifact: GeneratedGeometryArtifact
  onPlace: (artifact: GeneratedGeometryArtifact) => void
  onRemove: (artifact: GeneratedGeometryArtifact) => void
}) {
  const partCount = artifact.createdNames.length || artifact.shapes.length

  return (
    <div className="group rounded-xl border border-border/60 bg-background/60 p-1.5 transition-colors hover:border-[#a684ff]/50 hover:bg-sidebar-accent/60">
      <div className="relative flex aspect-square items-center justify-center overflow-hidden rounded-lg border border-border/40 bg-[radial-gradient(circle_at_35%_20%,rgba(166,132,255,0.22),transparent_34%),linear-gradient(135deg,rgba(255,255,255,0.06),rgba(255,255,255,0))]">
        <Icon className="size-9 text-[#a684ff] opacity-80" icon="mdi:shape-outline" />
        <span className="absolute top-1 left-1 rounded bg-[#a684ff]/90 px-1.5 py-0.5 font-medium text-[9px] text-white shadow-sm">
          AI
        </span>
      </div>
      <div className="mt-1.5 truncate px-0.5 font-medium text-[11px] text-muted-foreground group-hover:text-foreground" title={artifact.title}>
        {artifact.title}
      </div>
      <div className="px-0.5 text-[10px] text-muted-foreground/80">
        {partCount} parts · v{artifact.version}
      </div>
      <div className="mt-1 grid grid-cols-2 gap-1">
        <button
          className="rounded-md border border-[#a684ff]/45 bg-[#a684ff]/10 px-1.5 py-1 text-[10px] text-foreground transition-colors hover:bg-[#a684ff]/20"
          onClick={() => onPlace(artifact)}
          type="button"
        >
          放置
        </button>
        <button
          className="rounded-md border border-border/60 px-1.5 py-1 text-[10px] text-muted-foreground transition-colors hover:border-red-400/50 hover:text-red-300"
          onClick={() => onRemove(artifact)}
          type="button"
        >
          删除
        </button>
      </div>
    </div>
  )
}

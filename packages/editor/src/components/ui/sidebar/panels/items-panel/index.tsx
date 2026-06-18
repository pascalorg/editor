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

type GlbImportInspection = {
  triangles: number
}

type GlbImportOptimization = {
  status: 'optimized' | 'skipped' | 'failed'
  originalBytes: number
  finalBytes: number
}

type GlbImportResponse = {
  asset?: AssetInput
  error?: string
  originalInspection?: GlbImportInspection
  inspection?: GlbImportInspection
  optimization?: GlbImportOptimization
}

function itemMatchesCatalogCategory(item: AssetInput, category: CatalogCategory) {
  if (category === 'mine') return (item.source ?? 'library') === 'mine'
  return (
    item.category === category ||
    ((item.category === 'safety' ||
      item.category === 'lighting' ||
      item.category === 'electrical' ||
      item.category === 'hvac') &&
      category === 'electronics') ||
    (item.category === 'opening' && category === 'structural') ||
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

function formatCompactNumber(value: number) {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`
  if (value >= 1_000) return `${Math.round(value / 1_000)}k`
  return value.toLocaleString()
}

function formatBytes(value: number) {
  if (value >= 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)}MB`
  if (value >= 1024) return `${Math.round(value / 1024)}KB`
  return `${value}B`
}

function formatGlbImportSuccess(data: GlbImportResponse) {
  const originalTriangles = data.originalInspection?.triangles
  const finalTriangles = data.inspection?.triangles
  const originalBytes = data.optimization?.originalBytes
  const finalBytes = data.optimization?.finalBytes

  if (
    data.optimization?.status === 'optimized' &&
    originalTriangles !== undefined &&
    finalTriangles !== undefined &&
    originalBytes !== undefined &&
    finalBytes !== undefined
  ) {
    return `已优化并导入：${formatCompactNumber(originalTriangles)} -> ${formatCompactNumber(
      finalTriangles,
    )} 三角面，${formatBytes(originalBytes)} -> ${formatBytes(finalBytes)}`
  }

  return '已导入到我的物品，可点击放置'
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
  const [glbImportSuccess, setGlbImportSuccess] = useState<string | null>(null)
  const [assetDeleteError, setAssetDeleteError] = useState<string | null>(null)
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

  const openGlbPicker = () => glbInputRef.current?.click()

  async function importGlbFile(file: File | undefined) {
    if (!file) return
    if (!file.name.toLowerCase().endsWith('.glb')) {
      setGlbImportError('请选择 .glb 文件')
      setGlbImportSuccess(null)
      return
    }

    setGlbImporting(true)
    setGlbImportError(null)
    setGlbImportSuccess(null)
    try {
      const form = new FormData()
      form.set('model', file)
      form.set('name', file.name.replace(/\.glb$/i, ''))
      form.set('category', isMineCategory ? 'equipment' : activeCategory.catalogCategory)
      const res = await fetch('/api/imported-glb/assets', {
        method: 'POST',
        body: form,
      })
      const data = (await res.json().catch(() => ({}))) as GlbImportResponse
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
      setGlbImportSuccess('已导入到我的物品，可点击放置')
      window.dispatchEvent(new Event(IMPORTED_ASSETS_UPDATED_EVENT))
    } catch (error) {
      setGlbImportError(error instanceof Error ? error.message : String(error))
    } finally {
      setGlbImporting(false)
    }
  }

  function handleGlbSelected(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0]
    event.currentTarget.value = ''
    void importGlbFile(file)
  }

  function handleGlbDrop(event: React.DragEvent<HTMLElement>) {
    event.preventDefault()
    if (glbImporting) return

    const file =
      Array.from(event.dataTransfer.files).find((candidate) =>
        candidate.name.toLowerCase().endsWith('.glb'),
      ) ?? event.dataTransfer.files[0]

    void importGlbFile(file)
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
    const result = placeGeneratedGeometryArtifact(artifact, { startPlacement: true })
    if (result.nodeIds.length > 0 && mode !== 'build') setMode('build')
  }

  const removeGeneratedGeometryAsset = (artifact: GeneratedGeometryArtifact) => {
    removeGeneratedGeometryArtifactFromLocalLibrary(artifact.id)
    setGeneratedGeometryArtifacts((prev) => prev.filter((item) => item.id !== artifact.id))
  }

  const deleteGeneratedItemAsset = async (item: AssetInput) => {
    const assetId = (item as { id?: unknown }).id
    if (typeof assetId !== 'string' || !assetId) return

    setAssetDeleteError(null)
    const endpoint = item.tags?.includes('articraft')
      ? '/api/articraft/assets'
      : '/api/imported-glb/assets'

    try {
      const res = await fetch(`${endpoint}?id=${encodeURIComponent(assetId)}`, { method: 'DELETE' })
      const data = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) throw new Error(data.error || `删除失败 (${res.status})`)

      setGeneratedItems((prev) => prev.filter((asset) => (asset as { id?: unknown }).id !== assetId))
      if ((useEditor.getState().selectedItem as { id?: unknown } | null)?.id === assetId) {
        useEditor.setState({ selectedItem: null })
      }
      window.dispatchEvent(new Event(IMPORTED_ASSETS_UPDATED_EVENT))
      window.dispatchEvent(new Event('articraft:assets-updated'))
      window.dispatchEvent(new Event('generated-assets:updated'))
    } catch (error) {
      setAssetDeleteError(error instanceof Error ? error.message : String(error))
    }
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
        <input
          accept=".glb,model/gltf-binary"
          className="hidden"
          disabled={glbImporting}
          onChange={handleGlbSelected}
          ref={glbInputRef}
          type="file"
        />

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
        </div>

        {isMineCategory ? (
          <GlbImportCard importing={glbImporting} onChoose={openGlbPicker} onDrop={handleGlbDrop} />
        ) : null}

        {glbImportError ? <div className="text-[10px] text-red-400">{glbImportError}</div> : null}
        {glbImportSuccess ? (
          <div className="text-[10px] text-emerald-400">{glbImportSuccess}</div>
        ) : null}
        {assetDeleteError ? <div className="text-[10px] text-red-400">{assetDeleteError}</div> : null}

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
      <div className="min-h-0 flex-1 overflow-y-auto p-3 [scrollbar-color:#3a3a3d_#050505] [scrollbar-width:thin] [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-button]:hidden [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-[#3a3a3d] [&::-webkit-scrollbar-track]:bg-[#050505]">
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
                <div className="grid grid-cols-2 gap-1.5">
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
              onDeleteItem={isMineCategory ? deleteGeneratedItemAsset : undefined}
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

function GlbImportButton({
  importing,
  onClick,
}: {
  importing: boolean
  onClick: () => void
}) {
  return (
    <button
      aria-label="导入 GLB 文件"
      className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-[#a684ff]/60 bg-[#a684ff]/20 px-2.5 py-1.5 font-medium text-[11px] text-[#d9ccff] transition-colors hover:border-[#c7adff]/80 hover:bg-[#a684ff]/30 hover:text-white focus:outline-none focus:ring-2 focus:ring-[#a684ff]/60 disabled:cursor-not-allowed disabled:opacity-60"
      disabled={importing}
      onClick={onClick}
      type="button"
    >
      {importing ? (
        <span className="size-3 animate-spin rounded-full border border-[#d9ccff]/35 border-t-[#d9ccff]" />
      ) : (
        <Icon aria-hidden className="size-3.5" icon="mdi:upload" />
      )}
      <span>{importing ? '导入中…' : '导入 GLB'}</span>
    </button>
  )
}

function GlbImportCard({
  importing,
  onChoose,
  onDrop,
}: {
  importing: boolean
  onChoose: () => void
  onDrop: (event: React.DragEvent<HTMLElement>) => void
}) {
  return (
    <div
      className="flex items-center justify-between gap-2 rounded-xl border border-[#a684ff]/30 bg-[#a684ff]/10 p-2 transition-colors hover:border-[#c7adff]/70 hover:bg-[#a684ff]/15"
      onDragOver={(event) => event.preventDefault()}
      onDrop={onDrop}
    >
      <div className="min-w-0">
        <div className="font-medium text-[12px] text-foreground">添加物品</div>
        <div className="truncate text-[10px] text-muted-foreground">
          导入后保存到我的物品，可直接放置
        </div>
      </div>
      <GlbImportButton importing={importing} onClick={onChoose} />
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
  return (
    <div
      className="group flex min-h-10 items-center gap-2 rounded-lg border border-border/50 bg-[#2C2C2E]/70 px-2 py-1.5 text-left transition-[background-color,border-color,color,box-shadow] hover:cursor-pointer hover:border-primary/35 hover:bg-white/5 hover:text-foreground"
      onClick={() => onPlace(artifact)}
      onKeyDown={(event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return
        event.preventDefault()
        onPlace(artifact)
      }}
      role="button"
      tabIndex={0}
    >
      <div className="flex size-6 shrink-0 items-center justify-center rounded-md bg-muted/70 text-muted-foreground transition-colors group-hover:bg-muted group-hover:text-foreground">
        <Icon aria-hidden className="size-3.5" icon="mdi:shape-outline" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium text-[12px] text-foreground leading-4">
          {artifact.title}
        </div>
        <div className="mt-0.5 flex items-center gap-1.5 text-[9px] text-muted-foreground/75">
          <span className="rounded bg-muted/60 px-1.5 py-0.5 leading-none transition-colors group-hover:bg-muted/80 group-hover:text-muted-foreground">
            {'\u51e0\u4f55\u642d\u5efa'}
          </span>
        </div>
      </div>
      <button
        aria-label={`\u5220\u9664 ${artifact.title}`}
        className="flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground/70 opacity-0 transition-[background-color,color,opacity] hover:bg-destructive/15 hover:text-destructive group-hover:opacity-100"
        onClick={(event) => {
          event.preventDefault()
          event.stopPropagation()
          onRemove(artifact)
        }}
        title={'\u5220\u9664'}
        type="button"
      >
        {'\u00d7'}
      </button>
    </div>
  )
}

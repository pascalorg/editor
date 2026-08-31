'use client'

import {
  getCatalogMaterialById,
  getDynamicLibraryMaterials,
  getLibraryMaterialIdFromRef,
  getLibraryMaterialsVersion,
  getMaterialsForCategory,
  MATERIAL_CATEGORIES,
  type MaterialCatalogItem,
  type MaterialSource,
  type MaterialTarget,
  subscribeLibraryMaterials,
  toLibraryMaterialRef,
} from '@pascal-app/core'
import { Plus } from 'lucide-react'
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { triggerSFX } from '../../../lib/sfx-bus'

export type MaterialSourceFilter = 'all' | MaterialSource

export type MaterialPickerProps = {
  selectedMaterialPreset?: string
  onSelectMaterialPreset?: (materialPreset: string) => void
  disabled?: boolean
  nodeType?: MaterialTarget
  hideSideControl?: boolean
  onCreateMaterialRequest?: () => void
}

const SOURCE_FILTERS: { id: MaterialSourceFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'pascal', label: 'Pascal' },
  { id: 'mine', label: 'Mine' },
  { id: 'workspace', label: 'Workspace' },
  { id: 'community', label: 'Community' },
]

function getCategoryLabel(category: (typeof MATERIAL_CATEGORIES)[number]) {
  return category.charAt(0).toUpperCase() + category.slice(1)
}

function filterBySource(items: MaterialCatalogItem[], filter: MaterialSourceFilter) {
  if (filter === 'all') return items
  return items.filter((item) => (item.source ?? 'pascal') === filter)
}

/**
 * Catalog material picker: a fixed row of category tabs and a source filter row
 * over a scrollable grid of swatches. Scene-material creation lives in the
 * scene-material section (the host's `+` action); `onCreateMaterialRequest` is
 * the host's entry point for authoring a new *library* material.
 */
export function MaterialPicker({
  selectedMaterialPreset,
  onSelectMaterialPreset,
  disabled = false,
  onCreateMaterialRequest,
}: MaterialPickerProps) {
  const [selectedCategory, setSelectedCategory] = useState<(typeof MATERIAL_CATEGORIES)[number]>(
    MATERIAL_CATEGORIES[0],
  )
  const [sourceFilter, setSourceFilter] = useState<MaterialSourceFilter>('all')
  // Version counter so host registrations/unregistrations re-render the picker.
  const libraryVersion = useSyncExternalStore(
    subscribeLibraryMaterials,
    getLibraryMaterialsVersion,
    getLibraryMaterialsVersion,
  )
  const hasWorkspaceMaterials = useMemo(
    () => getDynamicLibraryMaterials().some((item) => item.source === 'workspace'),
    [libraryVersion],
  )
  const visibleSourceFilters = SOURCE_FILTERS.filter(
    (filter) => filter.id !== 'workspace' || hasWorkspaceMaterials,
  )
  const availableCategories = MATERIAL_CATEGORIES.filter(
    (category) => getMaterialsForCategory(category).length > 0,
  )
  const catalogItems = filterBySource(getMaterialsForCategory(selectedCategory), sourceFilter)

  // Keep the visible category in sync with the externally-selected catalog
  // material (a `scene:` ref matches no catalog entry, so the tab stays put).
  useEffect(() => {
    const catalogId = getLibraryMaterialIdFromRef(selectedMaterialPreset) ?? undefined
    const entry = getCatalogMaterialById(catalogId)
    if (entry?.category) setSelectedCategory(entry.category)
  }, [selectedMaterialPreset])

  const handleCatalogSelect = (materialId: string) => {
    if (disabled) return
    onSelectMaterialPreset?.(toLibraryMaterialRef(materialId))
  }

  return (
    <div
      className={`flex h-full min-h-0 flex-col gap-2 ${disabled ? 'pointer-events-none opacity-50' : ''}`}
    >
      {/* Fixed category tabs — outside the scroll region. */}
      <div className="flex shrink-0 flex-wrap gap-1">
        {availableCategories.map((category) => (
          <button
            className={`rounded-full px-3 py-1 font-medium text-xs transition-colors ${
              selectedCategory === category
                ? 'bg-foreground text-background'
                : 'text-muted-foreground hover:text-foreground'
            }`}
            key={category}
            onClick={() => {
              setSelectedCategory(category)
              // Auto-select the first material in the category so the brush is
              // immediately ready (and the swatch shows as selected).
              const first = filterBySource(getMaterialsForCategory(category), sourceFilter)[0]
              if (first) handleCatalogSelect(first.id)
            }}
            type="button"
          >
            {getCategoryLabel(category)}
          </button>
        ))}
      </div>
      {/* Fixed source filter tabs — underline style, matching the catalog
          browse surfaces (Items / Rooms / Build / Search) rather than the
          pill-button category row above. */}
      <div className="flex shrink-0 items-center gap-4 px-1">
        {visibleSourceFilters.map((filter) => (
          <button
            className={`-mb-px border-b-2 px-0.5 py-1.5 font-medium text-xs transition-colors ${
              sourceFilter === filter.id
                ? 'border-foreground text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
            key={filter.id}
            onClick={() => {
              triggerSFX('sfx:menu-click')
              setSourceFilter(filter.id)
            }}
            onMouseEnter={() => triggerSFX('sfx:menu-hover')}
            type="button"
          >
            {filter.label}
          </button>
        ))}
      </div>
      {/* The only scrolling region. */}
      <div
        className="subtle-scrollbar grid min-h-0 flex-1 auto-rows-min gap-2 overflow-y-auto pb-1"
        style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(72px, 1fr))' }}
      >
        {onCreateMaterialRequest ? (
          <button
            className="group relative flex flex-col gap-1.5 rounded-xl p-1.5 transition-colors hover:cursor-pointer hover:bg-sidebar-accent"
            onClick={() => {
              triggerSFX('sfx:menu-click')
              onCreateMaterialRequest()
            }}
            onMouseEnter={() => triggerSFX('sfx:menu-hover')}
            type="button"
          >
            <div className="flex aspect-square w-full items-center justify-center rounded-lg border border-border/45 border-dashed">
              <Plus className="size-5 text-muted-foreground group-hover:text-foreground" />
            </div>
            <span className="truncate px-0.5 text-left font-medium text-[11px] text-muted-foreground group-hover:text-foreground">
              New material
            </span>
          </button>
        ) : null}
        {catalogItems.map((item) => {
          const isSelected = selectedMaterialPreset === toLibraryMaterialRef(item.id)
          return (
            <button
              className={`group relative flex flex-col gap-1.5 rounded-xl p-1.5 transition-colors hover:cursor-pointer hover:bg-sidebar-accent ${
                isSelected ? 'bg-sidebar-accent ring-1 ring-primary ring-inset' : ''
              }`}
              key={item.id}
              onClick={() => {
                triggerSFX('sfx:menu-click')
                handleCatalogSelect(item.id)
              }}
              onMouseEnter={() => triggerSFX('sfx:menu-hover')}
              type="button"
            >
              <div className="relative aspect-square w-full overflow-hidden rounded-lg">
                {item.previewThumbnailUrl ? (
                  <img
                    alt={item.label}
                    className="h-full w-full object-cover"
                    src={item.previewThumbnailUrl}
                  />
                ) : (
                  <div
                    className="h-full w-full"
                    style={{ backgroundColor: item.previewColor ?? '#f3f4f6' }}
                  />
                )}
              </div>
              <span className="truncate px-0.5 text-left font-medium text-[11px] text-muted-foreground group-hover:text-foreground">
                {item.label}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

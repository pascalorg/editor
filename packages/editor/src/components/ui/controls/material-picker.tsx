'use client'

import {
  getCatalogMaterialById,
  getLibraryMaterialIdFromRef,
  getMaterialsForCategory,
  MATERIAL_CATEGORIES,
  type MaterialTarget,
  toLibraryMaterialRef,
} from '@pascal-app/core'
import { useEffect, useState } from 'react'
import { triggerSFX } from '../../../lib/sfx-bus'

type MaterialPickerProps = {
  selectedMaterialPreset?: string
  onSelectMaterialPreset?: (materialPreset: string) => void
  disabled?: boolean
  nodeType?: MaterialTarget
  hideSideControl?: boolean
}

function getCategoryLabel(category: (typeof MATERIAL_CATEGORIES)[number]) {
  return category.charAt(0).toUpperCase() + category.slice(1)
}

/**
 * Catalog material picker: a fixed row of category tabs over a scrollable grid
 * of swatches. Custom-material creation lives in the scene-material section
 * (the host's `+` action), not here, so it's available from any category.
 */
export function MaterialPicker({
  selectedMaterialPreset,
  onSelectMaterialPreset,
  disabled = false,
}: MaterialPickerProps) {
  const [selectedCategory, setSelectedCategory] = useState<(typeof MATERIAL_CATEGORIES)[number]>(
    MATERIAL_CATEGORIES[0],
  )
  const availableCategories = MATERIAL_CATEGORIES.filter(
    (category) => getMaterialsForCategory(category).length > 0,
  )
  const catalogItems = getMaterialsForCategory(selectedCategory)

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
              const first = getMaterialsForCategory(category)[0]
              if (first) handleCatalogSelect(first.id)
            }}
            type="button"
          >
            {getCategoryLabel(category)}
          </button>
        ))}
      </div>
      {/* The only scrolling region. */}
      <div
        className="subtle-scrollbar grid min-h-0 flex-1 auto-rows-min gap-2 overflow-y-auto pb-1"
        style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(72px, 1fr))' }}
      >
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

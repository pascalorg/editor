'use client'

import {
  getCatalogMaterialById,
  getLibraryMaterialIdFromRef,
  getMaterialsForCategory,
  MATERIAL_CATEGORIES,
  type MaterialSchema,
  type MaterialTarget,
  toLibraryMaterialRef,
} from '@pascal-app/core'
import { useEffect, useState } from 'react'
import { triggerSFX } from '../../../lib/sfx-bus'

type MaterialPickerProps = {
  value?: MaterialSchema
  selectedMaterialPreset?: string
  onChange?: (material: MaterialSchema) => void
  onSelectMaterialPreset?: (materialPreset: string) => void
  disabled?: boolean
  nodeType?: MaterialTarget
  hideSideControl?: boolean
}

function getCategoryLabel(category: (typeof MATERIAL_CATEGORIES)[number]) {
  return category.charAt(0).toUpperCase() + category.slice(1)
}

export function MaterialPicker({
  value,
  selectedMaterialPreset,
  onChange,
  onSelectMaterialPreset,
  disabled = false,
}: MaterialPickerProps) {
  const [showCustom, setShowCustom] = useState<boolean>(!!value?.properties)
  const [selectedCategory, setSelectedCategory] = useState<(typeof MATERIAL_CATEGORIES)[number]>(
    MATERIAL_CATEGORIES[0],
  )
  const availableCategories = MATERIAL_CATEGORIES.filter(
    (category) => getMaterialsForCategory(category).length > 0,
  )
  const catalogItems = getMaterialsForCategory(selectedCategory)

  useEffect(() => {
    setShowCustom(!!value?.properties && !selectedMaterialPreset)
  }, [selectedMaterialPreset, value?.properties])

  useEffect(() => {
    if (!selectedMaterialPreset && value?.properties) {
      setSelectedCategory('colors')
      return
    }

    const catalogId =
      getLibraryMaterialIdFromRef(selectedMaterialPreset) ?? value?.id ?? undefined
    const selectedCatalogEntry = getCatalogMaterialById(catalogId)
    if (selectedCatalogEntry?.category) {
      setSelectedCategory(selectedCatalogEntry.category)
    }
  }, [selectedMaterialPreset, value?.id])

  const selectedCatalogId =
    selectedMaterialPreset ?? (value?.id ? toLibraryMaterialRef(value.id) : undefined)
  const selectedCatalogMaterialId = getLibraryMaterialIdFromRef(selectedCatalogId) ?? undefined
  const selectedCatalogEntry = getCatalogMaterialById(selectedCatalogMaterialId)

  const handleCatalogSelect = (materialId: string) => {
    if (disabled) return
    setShowCustom(false)
    onSelectMaterialPreset?.(toLibraryMaterialRef(materialId))
  }

  // Seed a new custom material from the current/forked colour and hand it to
  // the host (MaterialPaintPanel), which pre-creates a scene material the user
  // edits inline in the build pane — no separate right-side editor pane.
  const handleCustomOpen = () => {
    if (disabled) return
    const forkColor = selectedMaterialPreset
      ? (selectedCatalogEntry?.previewColor ?? '#ffffff')
      : '#ffffff'
    onChange?.({
      preset: 'custom',
      properties: {
        color: value?.properties?.color || forkColor,
        roughness: value?.properties?.roughness ?? 0.5,
        metalness: value?.properties?.metalness ?? 0,
        opacity: value?.properties?.opacity ?? 1,
        transparent: value?.properties?.transparent ?? false,
        side: value?.properties?.side ?? 'front',
      },
    })
  }

  return (
    <div className={`min-w-0 space-y-3 ${disabled ? 'pointer-events-none opacity-50' : ''}`}>
      {(catalogItems.length > 0 || onChange) && (
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap gap-1 pb-1">
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
                  if (showCustom) {
                    setShowCustom(false)
                  }
                }}
                type="button"
              >
                {getCategoryLabel(category)}
              </button>
            ))}
          </div>
          <div
            className="grid gap-2 pb-1"
            style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(72px, 1fr))' }}
          >
            {catalogItems.map((item) => {
              const isSelected = selectedCatalogId === toLibraryMaterialRef(item.id)
              return (
                <button
                  className={`group relative flex flex-col gap-1.5 rounded-xl p-1.5 transition-colors hover:cursor-pointer hover:bg-sidebar-accent ${
                    isSelected ? 'bg-sidebar-accent ring-2 ring-primary-foreground' : ''
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
            {selectedCategory === 'colors' && onChange ? (
              <button
                className={`group relative flex flex-col gap-1.5 rounded-xl p-1.5 transition-colors hover:cursor-pointer hover:bg-sidebar-accent ${
                  showCustom ? 'bg-sidebar-accent ring-2 ring-primary-foreground' : ''
                }`}
                onClick={() => {
                  triggerSFX('sfx:menu-click')
                  handleCustomOpen()
                }}
                onMouseEnter={() => triggerSFX('sfx:menu-hover')}
                type="button"
              >
                <div className="flex aspect-square w-full items-center justify-center rounded-lg bg-muted text-lg text-muted-foreground group-hover:text-foreground">
                  +
                </div>
                <span className="truncate px-0.5 text-left font-medium text-[11px] text-muted-foreground group-hover:text-foreground">
                  Custom
                </span>
              </button>
            ) : null}
          </div>
        </div>
      )}
    </div>
  )
}

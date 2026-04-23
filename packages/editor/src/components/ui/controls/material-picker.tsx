'use client'

import {
  getCatalogMaterialById,
  getLibraryMaterialIdFromRef,
  getMaterialsForCategory,
  MATERIAL_CATEGORIES,
  toLibraryMaterialRef,
  type MaterialCategory,
  type MaterialSchema,
} from '@pascal-app/core'
import { useEffect, useRef, useState } from 'react'
import useEditor from '../../../store/use-editor'

type MaterialPickerProps = {
  value?: MaterialSchema
  selectedMaterialPreset?: string
  onChange?: (material: MaterialSchema, category: MaterialCategory) => void
  onSelectMaterialPreset?: (materialPreset: string, category: MaterialCategory) => void
  disabled?: boolean
}

export function MaterialPicker({
  value,
  selectedMaterialPreset,
  onChange,
  onSelectMaterialPreset,
  disabled = false,
}: MaterialPickerProps) {
  const setPaintPanelOpen = useEditor((state) => state.setPaintPanelOpen)
  const [showCustom, setShowCustom] = useState<boolean>(!!value?.properties)
  const [selectedCategory, setSelectedCategory] = useState<MaterialCategory>(MATERIAL_CATEGORIES[0])
  const catalogScrollRef = useRef<HTMLDivElement>(null)
  const catalogItems =
    selectedCategory === 'other'
      ? getMaterialsForCategory('other')
      : getMaterialsForCategory(selectedCategory)

  useEffect(() => {
    setShowCustom(!!value?.properties && !selectedMaterialPreset)
  }, [selectedMaterialPreset, value?.properties])

  useEffect(() => {
    if (!selectedMaterialPreset && value?.properties) {
      setSelectedCategory('other')
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

  const handleCatalogSelect = (materialId: string) => {
    if (disabled) return
    setShowCustom(false)
    setPaintPanelOpen(false)
    const category = getCatalogMaterialById(materialId)?.category
    if (!category) return
    onSelectMaterialPreset?.(toLibraryMaterialRef(materialId), category)
  }

  useEffect(() => {
    const container = catalogScrollRef.current
    if (!container) return

    const handleWheel = (event: WheelEvent) => {
      const deltaX = event.deltaX
      const deltaY = event.deltaY
      const nextScrollLeft = container.scrollLeft + deltaX + deltaY

      if (nextScrollLeft === container.scrollLeft) return

      event.preventDefault()
      container.scrollLeft = nextScrollLeft
    }

    container.addEventListener('wheel', handleWheel, { passive: false })
    return () => {
      container.removeEventListener('wheel', handleWheel)
    }
  }, [catalogItems.length, onChange, showCustom])

  const handleCustomOpen = () => {
    if (disabled) return
    setShowCustom(true)
    setPaintPanelOpen(true)
    onChange?.(
      {
        preset: 'custom',
        properties: {
          color: value?.properties?.color || '#ffffff',
          roughness: value?.properties?.roughness ?? 0.5,
          metalness: value?.properties?.metalness ?? 0,
          opacity: value?.properties?.opacity ?? 1,
          transparent: value?.properties?.transparent ?? false,
          side: value?.properties?.side ?? 'front',
        },
      },
      'other',
    )
  }

  return (
    <div className={`min-w-0 space-y-3 ${disabled ? 'pointer-events-none opacity-50' : ''}`}>
      {(catalogItems.length > 0 || onChange) && (
        <div className="min-w-0 space-y-2">
          <div className="flex flex-wrap gap-1">
            {MATERIAL_CATEGORIES.map((category) => (
              <button
                className={`px-2 font-medium text-[11px] uppercase tracking-[0.12em] transition-all ${
                  selectedCategory === category
                    ? 'bg-transparent text-foreground'
                    : 'bg-transparent text-muted-foreground opacity-70 hover:text-foreground hover:opacity-100'
                }`}
                key={category}
                onClick={() => {
                  setSelectedCategory(category)
                  if (showCustom) {
                    setShowCustom(false)
                  }
                  if (category !== 'other') {
                    setPaintPanelOpen(false)
                  }
                }}
                type="button"
              >
                {category.charAt(0).toUpperCase() + category.slice(1)}
              </button>
            ))}
          </div>
          <div
            className="w-full max-w-full overflow-x-auto overflow-y-hidden"
            ref={catalogScrollRef}
            style={{ msOverflowStyle: 'none', scrollbarWidth: 'none' }}
          >
            <div className="flex min-w-max gap-1.5 pb-1">
              {catalogItems.map((item) => (
                <button
                  className={`relative h-14 w-14 shrink-0 overflow-hidden rounded-lg border transition-all ${
                    selectedCatalogId === toLibraryMaterialRef(item.id)
                      ? 'border-blue-500 ring-2 ring-blue-500/30'
                      : 'border-gray-300 hover:border-gray-400'
                  }`}
                  key={item.id}
                  onClick={() => handleCatalogSelect(item.id)}
                  title={item.label}
                  type="button"
                >
                  <div className="pointer-events-none absolute inset-0 rounded-[inherit] ring-1 ring-inset ring-white/12" />
                  {item.previewThumbnailUrl ? (
                    <img
                      alt={item.label}
                      className="h-full w-full object-cover"
                      src={item.previewThumbnailUrl}
                    />
                  ) : item.previewColor ? (
                    <div className="h-full w-full" style={{ backgroundColor: item.previewColor }} />
                  ) : (
                    <div className="h-full w-full bg-gray-100" />
                  )}
                </button>
              ))}
              {selectedCategory === 'other' && onChange ? (
                <button
                  className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-lg border text-[10px] font-medium transition-all ${
                    showCustom
                      ? 'border-blue-500 ring-2 ring-blue-500/30'
                      : 'border-gray-300 hover:border-gray-400'
                  }`}
                  onClick={handleCustomOpen}
                  title="Custom"
                  type="button"
                >
                  Custom
                </button>
              ) : null}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

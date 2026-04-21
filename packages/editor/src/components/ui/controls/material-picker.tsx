'use client'

import {
  getMaterialsForTarget,
  toLibraryMaterialRef,
  type MaterialSchema,
  type MaterialTarget,
} from '@pascal-app/core'
import { useEffect, useRef, useState } from 'react'

type MaterialPickerProps = {
  nodeType?: MaterialTarget
  value?: MaterialSchema
  selectedMaterialPreset?: string
  onChange?: (material: MaterialSchema) => void
  onSelectMaterialPreset?: (materialPreset: string) => void
  hideSideControl?: boolean
  disabled?: boolean
}

export function MaterialPicker({
  nodeType,
  value,
  selectedMaterialPreset,
  onChange,
  onSelectMaterialPreset,
  hideSideControl = false,
  disabled = false,
}: MaterialPickerProps) {
  const [showCustom, setShowCustom] = useState<boolean>(!!value?.properties)
  const catalogScrollRef = useRef<HTMLDivElement>(null)
  const catalogItems = nodeType ? getMaterialsForTarget(nodeType) : []

  useEffect(() => {
    setShowCustom(!!value?.properties && !selectedMaterialPreset)
  }, [selectedMaterialPreset, value?.properties])

  const currentProps = value?.properties || {
    color: '#ffffff',
    roughness: 0.5,
    metalness: 0,
    opacity: 1,
    transparent: false,
    side: 'front' as const,
  }
  const selectedCatalogId =
    selectedMaterialPreset ?? (value?.id ? toLibraryMaterialRef(value.id) : undefined)

  const handleCatalogSelect = (materialId: string) => {
    if (disabled) return
    setShowCustom(false)
    onSelectMaterialPreset?.(toLibraryMaterialRef(materialId))
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
    onChange?.({
      preset: 'custom',
      properties: {
        color: value?.properties?.color || '#ffffff',
        roughness: value?.properties?.roughness ?? 0.5,
        metalness: value?.properties?.metalness ?? 0,
        opacity: value?.properties?.opacity ?? 1,
        transparent: value?.properties?.transparent ?? false,
        side: value?.properties?.side ?? 'front',
      },
    })
  }

  const handlePropertyChange = (
    prop: keyof typeof currentProps,
    val: (typeof currentProps)[keyof typeof currentProps],
  ) => {
    if (disabled) return
    onChange?.({
      preset: 'custom',
      properties: {
        ...currentProps,
        [prop]: val,
      },
    })
  }

  return (
    <div className={`min-w-0 space-y-3 ${disabled ? 'pointer-events-none opacity-50' : ''}`}>
      {(catalogItems.length > 0 || onChange) && (
        <div className="min-w-0 space-y-2">
          {catalogItems.length > 0 ? (
            <div className="text-gray-500 text-xs uppercase tracking-[0.16em]">Library</div>
          ) : null}
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
              {onChange ? (
                <button
                  className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-lg border text-[10px] font-medium transition-all ${
                    showCustom
                      ? 'border-blue-500 bg-blue-50 text-blue-700 ring-2 ring-blue-500/30'
                      : 'border-gray-300 bg-white text-gray-500 hover:border-gray-400'
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

      {showCustom && onChange && (
        <div className="space-y-2 pt-2">
          <div className="flex items-center gap-2">
            <label className="w-16 text-gray-500 text-xs">Color</label>
            <input
              className="h-7 w-12 cursor-pointer rounded border border-gray-300"
              onChange={(e) => handlePropertyChange('color', e.target.value)}
              type="color"
              value={currentProps.color}
            />
            <input
              className="h-7 flex-1 rounded border border-gray-300 px-2 text-xs"
              onChange={(e) => handlePropertyChange('color', e.target.value)}
              type="text"
              value={currentProps.color}
            />
          </div>

          <div className="flex items-center gap-2">
            <label className="w-16 text-gray-500 text-xs">Roughness</label>
            <input
              className="h-1.5 flex-1 cursor-pointer appearance-none rounded-lg bg-gray-200"
              max={1}
              min={0}
              onChange={(e) => handlePropertyChange('roughness', Number.parseFloat(e.target.value))}
              step={0.01}
              type="range"
              value={currentProps.roughness}
            />
            <span className="w-8 text-right text-gray-400 text-xs">
              {currentProps.roughness.toFixed(2)}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <label className="w-16 text-gray-500 text-xs">Metalness</label>
            <input
              className="h-1.5 flex-1 cursor-pointer appearance-none rounded-lg bg-gray-200"
              max={1}
              min={0}
              onChange={(e) => handlePropertyChange('metalness', Number.parseFloat(e.target.value))}
              step={0.01}
              type="range"
              value={currentProps.metalness}
            />
            <span className="w-8 text-right text-gray-400 text-xs">
              {currentProps.metalness.toFixed(2)}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <label className="w-16 text-gray-500 text-xs">Opacity</label>
            <input
              className="h-1.5 flex-1 cursor-pointer appearance-none rounded-lg bg-gray-200"
              max={1}
              min={0}
              onChange={(e) => {
                const opacity = Number.parseFloat(e.target.value)
                handlePropertyChange('opacity', opacity)
                if (opacity < 1 && !currentProps.transparent) {
                  handlePropertyChange('transparent', true)
                }
              }}
              step={0.01}
              type="range"
              value={currentProps.opacity}
            />
            <span className="w-8 text-right text-gray-400 text-xs">
              {currentProps.opacity.toFixed(2)}
            </span>
          </div>

          {!hideSideControl && (
            <div className="flex items-center gap-2">
              <label className="w-16 text-gray-500 text-xs">Side</label>
              <select
                className="h-7 flex-1 rounded border border-gray-300 px-2 text-xs"
                onChange={(e) =>
                  handlePropertyChange('side', e.target.value as 'front' | 'back' | 'double')
                }
                value={currentProps.side}
              >
                <option value="front">Front</option>
                <option value="back">Back</option>
                <option value="double">Double</option>
              </select>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

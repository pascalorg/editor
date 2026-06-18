'use client'

import {
  getCatalogMaterialById,
  getLibraryMaterialIdFromRef,
  getMaterialsForCategory,
  MATERIAL_CATEGORIES,
  type MaterialCatalogItem,
  type MaterialSchema,
  type MaterialTarget,
  toLibraryMaterialRef,
} from '@pascal-app/core'
import { useEffect, useState } from 'react'
import { cn } from '../../../lib/utils'
import useEditor from '../../../store/use-editor'

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
  if (category === 'wood') return '\u6728\u6750'
  if (category === 'flooring') return '\u5730\u9762'
  if (category === 'roof') return '\u5c4b\u9876'
  return category
}

type MaterialPickerTab = 'color' | 'fill'
const FILL_CATEGORIES = MATERIAL_CATEGORIES.filter((category) => category !== 'other')
const METAL_SWATCHES = [
  {
    id: 'metal-polished-gold',
    label: '\u4eae\u91d1',
    color: '#d4af37',
    gradient: 'linear-gradient(135deg, #fff6b8 0%, #d4af37 42%, #8a6f17 100%)',
    roughness: 0.22,
    metalness: 1,
  },
  {
    id: 'metal-champagne-gold',
    label: '\u9999\u69df\u91d1',
    color: '#f0d88a',
    gradient: 'linear-gradient(135deg, #fff8d7 0%, #f0d88a 48%, #b99a45 100%)',
    roughness: 0.32,
    metalness: 0.9,
  },
  {
    id: 'metal-antique-gold',
    label: '\u53e4\u91d1',
    color: '#b8860b',
    gradient: 'linear-gradient(135deg, #f2cf69 0%, #b8860b 48%, #5f4310 100%)',
    roughness: 0.48,
    metalness: 0.85,
  },
  {
    id: 'metal-brass',
    label: '\u9ec4\u94dc',
    color: '#b5a642',
    gradient: 'linear-gradient(135deg, #eadf8f 0%, #b5a642 45%, #6d6428 100%)',
    roughness: 0.38,
    metalness: 0.85,
  },
  {
    id: 'metal-rose-gold',
    label: '\u73ab\u7470\u91d1',
    color: '#b76e79',
    gradient: 'linear-gradient(135deg, #ffd1c8 0%, #b76e79 46%, #7b3f48 100%)',
    roughness: 0.3,
    metalness: 0.9,
  },
  {
    id: 'metal-copper-gold',
    label: '\u94dc\u91d1',
    color: '#b87333',
    gradient: 'linear-gradient(135deg, #f2b36f 0%, #b87333 48%, #6f3717 100%)',
    roughness: 0.35,
    metalness: 0.9,
  },
] as const

export function MaterialPicker({
  value,
  selectedMaterialPreset,
  onChange,
  onSelectMaterialPreset,
  disabled = false,
}: MaterialPickerProps) {
  const setPaintPanelOpen = useEditor((state) => state.setPaintPanelOpen)
  const [activeTab, setActiveTab] = useState<MaterialPickerTab>('color')

  useEffect(() => {
    const catalogId = getLibraryMaterialIdFromRef(selectedMaterialPreset) ?? value?.id ?? undefined
    const selectedCatalogEntry = getCatalogMaterialById(catalogId)
    if (selectedCatalogEntry?.category) setActiveTab('fill')
  }, [selectedMaterialPreset, value?.id])

  const selectedCatalogId =
    selectedMaterialPreset ?? (value?.id ? toLibraryMaterialRef(value.id) : undefined)

  const handleCatalogSelect = (materialId: string) => {
    if (disabled) return
    setPaintPanelOpen(false)
    onSelectMaterialPreset?.(toLibraryMaterialRef(materialId))
  }

  const writeCustomColor = (color: string) => {
    if (disabled) return
    setPaintPanelOpen(false)
    onChange?.({
      preset: 'custom',
      properties: {
        color,
        roughness: value?.properties?.roughness ?? 0.5,
        metalness: value?.properties?.metalness ?? 0,
        opacity: value?.properties?.opacity ?? 1,
        transparent: value?.properties?.transparent ?? false,
        side: value?.properties?.side ?? 'front',
      },
    })
  }

  const writeMetalSwatch = (swatch: (typeof METAL_SWATCHES)[number]) => {
    if (disabled) return
    setPaintPanelOpen(false)
    onChange?.({
      preset: 'custom',
      properties: {
        color: swatch.color,
        roughness: swatch.roughness,
        metalness: swatch.metalness,
        opacity: value?.properties?.opacity ?? 1,
        transparent: value?.properties?.transparent ?? false,
        side: value?.properties?.side ?? 'front',
      },
    })
  }

  const customColor = value?.properties?.color ?? '#ffffff'
  const colorPresets = [
    '#ffffff',
    '#f4f0e6',
    '#d8d1c3',
    '#a8a29e',
    '#6b7280',
    '#2f3437',
    '#8b5a3c',
    '#b77946',
    '#6f7f55',
    '#7f1d1d',
    '#1f4e79',
    '#111827',
  ]
  const selectedMetalSwatchId =
    !selectedMaterialPreset && value?.properties?.metalness && value.properties.metalness > 0.75
      ? METAL_SWATCHES.find(
          (swatch) => swatch.color.toLowerCase() === value.properties?.color?.toLowerCase(),
        )?.id
      : undefined

  return (
    <div className={`min-w-0 space-y-3 ${disabled ? 'pointer-events-none opacity-50' : ''}`}>
      <div className="grid grid-cols-2 rounded-lg border border-border/50 bg-[#202124] p-1">
        {[
          ['color', '\u989c\u8272'],
          ['fill', '\u586b\u5145'],
        ].map(([tab, label]) => (
          <button
            className={cn(
              'rounded-md px-2 py-1.5 font-medium text-[11px] transition-colors',
              activeTab === tab
                ? 'bg-white/10 text-foreground'
                : 'text-muted-foreground hover:bg-white/5 hover:text-foreground',
            )}
            key={tab}
            onClick={() => setActiveTab(tab as MaterialPickerTab)}
            type="button"
          >
            {label}
          </button>
        ))}
      </div>

      {activeTab === 'color' && onChange ? (
        <div className="space-y-3">
          <div className="space-y-1.5">
            <div className="font-medium text-foreground/80 text-xs">{'\u57fa\u7840\u989c\u8272'}</div>
            <div className="flex items-center gap-2">
              <input
                className="h-9 w-11 cursor-pointer rounded border border-border/50 bg-transparent p-0.5"
                onChange={(event) => writeCustomColor(event.target.value)}
                type="color"
                value={customColor}
              />
              <input
                className="h-9 flex-1 rounded-md border border-border/50 bg-[#2C2C2E] px-2 font-mono text-foreground text-xs focus:outline-none focus:ring-1 focus:ring-foreground/30"
                onChange={(event) => writeCustomColor(event.target.value)}
                type="text"
                value={customColor}
              />
            </div>
          </div>
          <div className="grid grid-cols-6 gap-1.5">
            {colorPresets.map((color) => (
              <button
                aria-label={color}
                className={cn(
                  'h-7 rounded-md border border-white/10 transition-transform hover:scale-105',
                  customColor.toLowerCase() === color && 'ring-2 ring-blue-500/50',
                )}
                key={color}
                onClick={() => writeCustomColor(color)}
                style={{ backgroundColor: color }}
                type="button"
              />
            ))}
          </div>
        </div>
      ) : null}

      {activeTab === 'fill' ? (
        <div className="max-h-72 space-y-3 overflow-y-auto pr-1">
          {FILL_CATEGORIES.map((category) => {
            const items = getMaterialsForCategory(category).slice(0, 18)
            if (items.length === 0) return null
            return (
              <div className="space-y-1.5" key={category}>
                <div className="font-medium text-muted-foreground text-[11px] uppercase tracking-[0.12em]">
                  {getCategoryLabel(category)}
                </div>
                <div className="grid grid-cols-6 gap-1.5">
                  {items.map((item) => (
                    <FillSwatchTile
                      isSelected={selectedCatalogId === toLibraryMaterialRef(item.id)}
                      key={item.id}
                      label={item.label}
                      previewColor={item.previewColor}
                      previewThumbnailUrl={item.previewThumbnailUrl}
                      onSelect={() => handleCatalogSelect(item.id)}
                    />
                  ))}
                </div>
              </div>
            )
          })}
          <div className="space-y-1.5">
            <div className="font-medium text-muted-foreground text-[11px] uppercase tracking-[0.12em]">
              {'\u91d1\u5c5e'}
            </div>
            <div className="grid grid-cols-6 gap-1.5">
              {METAL_SWATCHES.map((swatch) => (
                <FillSwatchTile
                  gradient={swatch.gradient}
                  isSelected={selectedMetalSwatchId === swatch.id}
                  key={swatch.id}
                  label={swatch.label}
                  previewColor={swatch.color}
                  onSelect={() => writeMetalSwatch(swatch)}
                />
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}

function FillSwatchTile({
  gradient,
  isSelected,
  label,
  onSelect,
  previewColor,
  previewThumbnailUrl,
}: {
  gradient?: string
  isSelected: boolean
  label: MaterialCatalogItem['label']
  onSelect: () => void
  previewColor?: MaterialCatalogItem['previewColor']
  previewThumbnailUrl?: MaterialCatalogItem['previewThumbnailUrl']
}) {
  return (
    <button
      className={cn(
        'relative h-11 w-11 shrink-0 overflow-hidden rounded-lg border transition-all hover:scale-[1.03]',
        isSelected
          ? 'border-blue-500 ring-2 ring-blue-500/30'
          : 'border-white/10 hover:border-white/30',
      )}
      onClick={onSelect}
      title={label}
      type="button"
    >
      <div className="pointer-events-none absolute inset-0 rounded-[inherit] ring-1 ring-white/12 ring-inset" />
      {previewThumbnailUrl ? (
        <img alt={label} className="h-full w-full object-cover" src={previewThumbnailUrl} />
      ) : gradient || previewColor ? (
        <div className="h-full w-full" style={{ background: gradient ?? previewColor }} />
      ) : (
        <div className="h-full w-full bg-gray-100" />
      )}
    </button>
  )
}

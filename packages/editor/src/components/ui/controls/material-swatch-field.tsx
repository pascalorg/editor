'use client'

import {
  getCatalogMaterialById,
  getLibraryMaterialIdFromRef,
  getMaterialPresetByRef,
  type MaterialSchema,
} from '@pascal-app/core'
import { ChevronDown } from 'lucide-react'
import { cn } from '../../../lib/utils'
import { Popover, PopoverContent, PopoverTrigger } from '../primitives/popover'
import { MaterialPicker } from './material-picker'

type MaterialSwatchFieldProps = {
  label: string
  value?: MaterialSchema
  selectedMaterialPreset?: string
  onChange?: (material: MaterialSchema) => void
  onSelectMaterialPreset?: (materialPreset: string) => void
  onOpenChange?: (open: boolean) => void
  description?: string
}

export function MaterialSwatchField({
  label,
  value,
  selectedMaterialPreset,
  onChange,
  onSelectMaterialPreset,
  onOpenChange,
  description,
}: MaterialSwatchFieldProps) {
  const catalogId = getLibraryMaterialIdFromRef(selectedMaterialPreset) ?? value?.id ?? undefined
  const catalogItem = getCatalogMaterialById(catalogId)
  const preset = getMaterialPresetByRef(selectedMaterialPreset)
  const color =
    value?.properties?.color ??
    catalogItem?.previewColor ??
    preset?.mapProperties.color ??
    '#ffffff'
  const name =
    value?.properties?.color && !selectedMaterialPreset
      ? value.properties.color
      : catalogItem?.label ?? description ?? '\u81ea\u5b9a\u4e49'

  return (
    <Popover onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <button
          className="flex w-full items-center gap-2 rounded-lg border border-border/50 bg-[#2C2C2E] px-2.5 py-2 text-left transition-colors hover:bg-[#3e3e3e]"
          type="button"
        >
          <span className="min-w-0 flex-1">
            <span className="block font-medium text-foreground text-xs">{label}</span>
            <span className="block truncate text-muted-foreground text-[11px]">{name}</span>
          </span>
          <span
            className={cn(
              'h-6 w-6 shrink-0 overflow-hidden rounded-md border border-white/15',
              !catalogItem?.previewThumbnailUrl && 'shadow-inner',
            )}
            style={catalogItem?.previewThumbnailUrl ? undefined : { backgroundColor: color }}
          >
            {catalogItem?.previewThumbnailUrl ? (
              <img
                alt=""
                className="h-full w-full object-cover"
                src={catalogItem.previewThumbnailUrl}
              />
            ) : null}
          </span>
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-80 rounded-xl border-border/45 bg-popover/95 p-3 shadow-elevation-3 backdrop-blur-xl"
        side="left"
        sideOffset={10}
      >
        <MaterialPicker
          selectedMaterialPreset={selectedMaterialPreset}
          value={value}
          onChange={onChange}
          onSelectMaterialPreset={onSelectMaterialPreset}
        />
      </PopoverContent>
    </Popover>
  )
}

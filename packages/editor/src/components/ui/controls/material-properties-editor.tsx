'use client'

import type { MaterialProperties, MaterialSchema } from '@pascal-app/core'
import { Input } from '../primitives/input'
import { SliderControl } from './slider-control'

const DEFAULT_MATERIAL_PROPERTIES: MaterialProperties = {
  color: '#ffffff',
  roughness: 0.5,
  metalness: 0,
  opacity: 1,
  transparent: false,
  side: 'front',
}

export function MaterialPropertiesEditor({
  value,
  onChange,
}: {
  value: MaterialSchema
  onChange: (next: MaterialSchema) => void
}) {
  const currentProps = value.properties ?? DEFAULT_MATERIAL_PROPERTIES

  const updateMaterial = (
    updates: Partial<MaterialProperties>,
    nextTransparent = currentProps.transparent,
  ) => {
    onChange({
      ...value,
      preset: value.preset ?? 'custom',
      properties: {
        ...currentProps,
        ...updates,
        transparent: nextTransparent,
      },
    })
  }

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <label className="block font-medium text-muted-foreground text-xs uppercase tracking-[0.12em]">
          Color
        </label>
        <div className="flex items-center gap-2">
          <input
            className="h-9 w-9 shrink-0 cursor-pointer rounded-md border border-input bg-transparent p-0 [&::-moz-color-swatch]:rounded-[5px] [&::-moz-color-swatch]:border-none [&::-webkit-color-swatch-wrapper]:p-0 [&::-webkit-color-swatch]:rounded-[5px] [&::-webkit-color-swatch]:border-none"
            onChange={(e) => updateMaterial({ color: e.target.value })}
            type="color"
            value={currentProps.color}
          />
          <Input
            onChange={(e) => updateMaterial({ color: e.target.value })}
            value={currentProps.color}
          />
        </div>
      </div>

      <SliderControl
        label="Roughness"
        max={1}
        min={0}
        onChange={(value) => updateMaterial({ roughness: value })}
        precision={2}
        step={0.01}
        value={currentProps.roughness}
      />

      <SliderControl
        label="Metalness"
        max={1}
        min={0}
        onChange={(value) => updateMaterial({ metalness: value })}
        precision={2}
        step={0.01}
        value={currentProps.metalness}
      />

      <SliderControl
        label="Opacity"
        max={1}
        min={0}
        onChange={(value) => updateMaterial({ opacity: value }, value < 1 || currentProps.transparent)}
        precision={2}
        step={0.01}
        value={currentProps.opacity}
      />

      <div className="space-y-2">
        <label className="block font-medium text-muted-foreground text-xs uppercase tracking-[0.12em]">
          Side
        </label>
        <select
          className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-xs outline-none transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-input/30"
          onChange={(e) =>
            updateMaterial({ side: e.target.value as 'front' | 'back' | 'double' })
          }
          value={currentProps.side}
        >
          <option value="front">Front</option>
          <option value="back">Back</option>
          <option value="double">Double</option>
        </select>
      </div>
    </div>
  )
}

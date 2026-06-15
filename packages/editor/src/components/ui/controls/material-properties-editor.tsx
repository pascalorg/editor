'use client'

import type { MaterialProperties, MaterialSchema } from '@pascal-app/core'
import { Input } from '../primitives/input'

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
            className="h-10 w-14 cursor-pointer rounded-md border border-input bg-transparent"
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

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <label className="font-medium text-muted-foreground text-xs uppercase tracking-[0.12em]">
            Roughness
          </label>
          <span className="font-mono text-muted-foreground text-xs">
            {currentProps.roughness.toFixed(2)}
          </span>
        </div>
        <input
          className="h-2 w-full cursor-pointer appearance-none rounded-full bg-accent"
          max={1}
          min={0}
          onChange={(e) => updateMaterial({ roughness: Number.parseFloat(e.target.value) })}
          step={0.01}
          type="range"
          value={currentProps.roughness}
        />
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <label className="font-medium text-muted-foreground text-xs uppercase tracking-[0.12em]">
            Metalness
          </label>
          <span className="font-mono text-muted-foreground text-xs">
            {currentProps.metalness.toFixed(2)}
          </span>
        </div>
        <input
          className="h-2 w-full cursor-pointer appearance-none rounded-full bg-accent"
          max={1}
          min={0}
          onChange={(e) => updateMaterial({ metalness: Number.parseFloat(e.target.value) })}
          step={0.01}
          type="range"
          value={currentProps.metalness}
        />
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <label className="font-medium text-muted-foreground text-xs uppercase tracking-[0.12em]">
            Opacity
          </label>
          <span className="font-mono text-muted-foreground text-xs">
            {currentProps.opacity.toFixed(2)}
          </span>
        </div>
        <input
          className="h-2 w-full cursor-pointer appearance-none rounded-full bg-accent"
          max={1}
          min={0}
          onChange={(e) => {
            const opacity = Number.parseFloat(e.target.value)
            updateMaterial({ opacity }, opacity < 1 || currentProps.transparent)
          }}
          step={0.01}
          type="range"
          value={currentProps.opacity}
        />
      </div>

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

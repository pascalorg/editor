'use client'

import { DEFAULT_MATERIALS, type MaterialPreset, type MaterialSchema } from '@pascal-app/core'
import { useState } from 'react'

const PRESET_COLORS: Record<MaterialPreset, string> = {
  white: '#ffffff',
  brick: '#8b4513',
  concrete: '#808080',
  wood: '#deb887',
  glass: '#87ceeb',
  metal: '#c0c0c0',
  plaster: '#f5f5dc',
  tile: '#d3d3d3',
  marble: '#fafafa',
  custom: '#ffffff',
}

const PRESET_LABELS: Record<MaterialPreset, string> = {
  white: 'White',
  brick: 'Brick',
  concrete: 'Concrete',
  wood: 'Wood',
  glass: 'Glass',
  metal: 'Metal',
  plaster: 'Plaster',
  tile: 'Tile',
  marble: 'Marble',
  custom: 'Custom',
}

type MaterialPickerProps = {
  value?: MaterialSchema
  onChange: (material: MaterialSchema) => void
}

export function MaterialPicker({ value, onChange }: MaterialPickerProps) {
  const [showCustom, setShowCustom] = useState<boolean>(
    value?.preset === 'custom' || !!value?.properties,
  )

  const currentPreset = value?.preset || 'white'
  const currentProps = value?.properties || DEFAULT_MATERIALS[currentPreset]

  const handlePresetChange = (preset: MaterialPreset) => {
    if (preset === 'custom') {
      setShowCustom(true)
      onChange({
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
    } else {
      setShowCustom(false)
      onChange({ preset })
    }
  }

  const handlePropertyChange = (
    prop: keyof typeof currentProps,
    val: (typeof currentProps)[keyof typeof currentProps],
  ) => {
    onChange({
      preset: showCustom ? 'custom' : currentPreset,
      properties: {
        ...currentProps,
        [prop]: val,
      },
    })
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-5 gap-1.5">
        {(Object.keys(PRESET_COLORS) as MaterialPreset[]).map((preset) => (
          <button
            className={`h-8 w-8 rounded border-2 transition-all ${
              currentPreset === preset
                ? 'border-blue-500 ring-2 ring-blue-500/30'
                : 'border-gray-300 hover:border-gray-400'
            }`}
            key={preset}
            onClick={() => handlePresetChange(preset)}
            style={{
              backgroundColor: PRESET_COLORS[preset],
              backgroundImage:
                preset === 'glass'
                  ? 'linear-gradient(135deg, rgba(255,255,255,0.3) 25%, transparent 25%, transparent 50%, rgba(255,255,255,0.3) 50%, rgba(255,255,255,0.3) 75%, transparent 75%, transparent)'
                  : undefined,
              backgroundSize: preset === 'glass' ? '8px 8px' : undefined,
            }}
            title={PRESET_LABELS[preset]}
            type="button"
          />
        ))}
      </div>

      {showCustom && (
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
        </div>
      )}
    </div>
  )
}

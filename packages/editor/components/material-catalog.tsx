'use client'

import { type PaintMode, useEditor } from '@/hooks/use-editor'
import { cn } from '@/lib/utils'

interface MaterialItem {
  id: string
  name: string
  color: string
  isTexture?: boolean
}

const MATERIAL_ITEMS: MaterialItem[] = [
  // Solid colors
  { id: 'white', name: 'White', color: '#ffffff' },
  { id: 'black', name: 'Black', color: '#1a1a1a' },
  { id: 'gray', name: 'Gray', color: '#808080' },
  { id: 'pink', name: 'Pink', color: '#ffb6c1' },
  { id: 'green', name: 'Green', color: '#4caf50' },
  { id: 'blue', name: 'Blue', color: '#2196f3' },
  { id: 'red', name: 'Red', color: '#f44336' },
  { id: 'orange', name: 'Orange', color: '#ff9800' },
  { id: 'yellow', name: 'Yellow', color: '#ffeb3b' },
  { id: 'purple', name: 'Purple', color: '#9c27b0' },
  // Textured materials
  { id: 'brick', name: 'Brick', color: '#aa6644', isTexture: true },
  { id: 'wood', name: 'Wood', color: '#bb8855', isTexture: true },
  { id: 'concrete', name: 'Concrete', color: '#999999', isTexture: true },
  { id: 'tile', name: 'Tile', color: '#dddddd', isTexture: true },
  { id: 'marble', name: 'Marble', color: '#f0f0f0', isTexture: true },
]

function PaintModeSwitch() {
  const paintMode = useEditor((state) => state.paintMode)
  const setPaintMode = useEditor((state) => state.setPaintMode)

  const modes: { value: PaintMode; label: string }[] = [
    { value: 'wall', label: 'By Wall' },
    { value: 'room', label: 'By Room' },
  ]

  return (
    <div className="flex rounded-lg bg-muted p-0.5">
      {modes.map((mode) => (
        <button
          className={cn(
            'rounded-md px-3 py-1 font-medium text-xs transition-colors',
            paintMode === mode.value
              ? 'bg-background text-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground',
          )}
          key={mode.value}
          onClick={() => setPaintMode(mode.value)}
          type="button"
        >
          {mode.label}
        </button>
      ))}
    </div>
  )
}

export function MaterialCatalog() {
  const selectedMaterial = useEditor((state) => state.selectedMaterial)
  const setSelectedMaterial = useEditor((state) => state.setSelectedMaterial)

  return (
    <div className="flex flex-col gap-3">
      {/* Paint mode switch */}
      <div className="flex items-center justify-between">
        <span className="text-muted-foreground text-xs">Paint Mode</span>
        <PaintModeSwitch />
      </div>

      {/* Material swatches */}
      <div className="-mx-2 -my-2 flex gap-2 overflow-x-auto p-2">
        {MATERIAL_ITEMS.map((material) => {
          const isSelected = selectedMaterial === material.id
          return (
            <button
              className={cn(
                'relative flex h-14 w-14 shrink-0 flex-col items-center justify-center gap-1 rounded-lg transition-all duration-200 ease-out hover:scale-105 hover:cursor-pointer',
                isSelected && 'ring-2 ring-primary-foreground',
              )}
              key={material.id}
              onClick={() => setSelectedMaterial(material.id)}
              style={{ backgroundColor: material.color }}
              title={material.name}
              type="button"
            >
              {material.isTexture && (
                <div
                  className="absolute inset-0 rounded-lg opacity-30"
                  style={{
                    backgroundImage: `repeating-linear-gradient(
                      45deg,
                      transparent,
                      transparent 4px,
                      rgba(0,0,0,0.1) 4px,
                      rgba(0,0,0,0.1) 8px
                    )`,
                  }}
                />
              )}
              <span
                className={cn(
                  'font-medium text-[10px] drop-shadow-sm',
                  ['white', 'yellow', 'tile', 'marble'].includes(material.id)
                    ? 'text-gray-800'
                    : 'text-white',
                )}
              >
                {material.name}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

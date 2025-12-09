'use client'

import { useEditor } from '@/hooks/use-editor'
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

export function MaterialCatalog() {
  const selectedMaterial = useEditor((state) => state.selectedMaterial)
  const setSelectedMaterial = useEditor((state) => state.setSelectedMaterial)

  return (
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
              <div className="absolute inset-0 rounded-lg opacity-30"
                style={{
                  backgroundImage: `repeating-linear-gradient(
                    45deg,
                    transparent,
                    transparent 4px,
                    rgba(0,0,0,0.1) 4px,
                    rgba(0,0,0,0.1) 8px
                  )`
                }}
              />
            )}
            <span className={cn(
              'text-[10px] font-medium drop-shadow-sm',
              ['white', 'yellow', 'tile', 'marble'].includes(material.id) ? 'text-gray-800' : 'text-white'
            )}>
              {material.name}
            </span>
          </button>
        )
      })}
    </div>
  )
}

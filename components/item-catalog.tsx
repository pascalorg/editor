'use client'

import { Package } from 'lucide-react'
import Image from 'next/image'
import { Button } from '@/components/ui/button'
import { useEditor } from '@/hooks/use-editor'
import { cn } from '@/lib/utils'

interface CatalogItem {
  thumbnail: string
  modelUrl: string
  scale: [number, number, number]
  size: [number, number]
  position?: [number, number, number] // Fine-tune position offset for GLB [x, y, z]
  rotation?: [number, number, number] // Fine-tune rotation for GLB [x, y, z] in radians
}

const CATALOG_ITEMS: CatalogItem[] = [
  {
    thumbnail: '/items/couch-medium/thumbnail.webp',
    modelUrl: '/items/couch-medium/model.glb',
    scale: [0.4, 0.4, 0.4],
    size: [4, 2],
  },
  {
    thumbnail: '/items/couch-small/thumbnail.webp',
    modelUrl: '/items/couch-small/model.glb',
    scale: [0.4, 0.4, 0.4],
    size: [3, 2],
  },
  {
    thumbnail: '/items/desk/thumbnail.webp',
    modelUrl: '/items/desk/model.glb',
    scale: [1, 1, 1],
    size: [4, 2],
  },
  {
    thumbnail: '/items/table/thumbnail.webp',
    modelUrl: '/items/table/model.glb',
    scale: [1, 1, 1],
    rotation: [0, Math.PI / 2, 0],
    size: [6, 3],
  },
]

export function ItemCatalog() {
  const activeTool = useEditor((state) => state.activeTool)
  const selectedItem = useEditor((state) => state.selectedItem)
  const setSelectedItem = useEditor((state) => state.setSelectedItem)

  // Only show catalog when item tool is active
  if (activeTool !== 'item') {
    return null
  }

  return (
    <div className="flex flex-col gap-2 p-2">
      <div className="flex items-center gap-2 px-2">
        <Package className="h-4 w-4" />
        <h4 className="font-medium text-sm">Item Catalog</h4>
      </div>

      <div className="h-[200px] overflow-y-auto">
        <div className="grid grid-cols-2 gap-2 p-2">
          {CATALOG_ITEMS.map((item, index) => {
            const isSelected = selectedItem.modelUrl === item.modelUrl
            return (
              <Button
                className={cn(
                  'h-auto flex-col gap-2 p-2',
                  isSelected && 'border-primary ring-2 ring-primary',
                )}
                key={index}
                onClick={() => setSelectedItem(item)}
                size="sm"
                variant="outline"
              >
                <div className="relative h-20 w-full overflow-hidden rounded-sm bg-muted">
                  <Image
                    alt={`Item ${index + 1}`}
                    className="object-cover"
                    fill
                    src={item.thumbnail}
                  />
                </div>
                <span className="text-xs">
                  {item.size[0]}x{item.size[1]}
                </span>
              </Button>
            )
          })}
        </div>
      </div>
    </div>
  )
}

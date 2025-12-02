'use client'

import Image from 'next/image'
import { useEffect } from 'react'
import { type CatalogCategory, useEditor } from '@/hooks/use-editor'
import { cn } from '@/lib/utils'

interface CatalogItem {
  category: CatalogCategory
  thumbnail: string
  modelUrl: string
  scale: [number, number, number]
  size: [number, number]
  position?: [number, number, number] // Fine-tune position offset for GLB [x, y, z]
  rotation?: [number, number, number] // Fine-tune rotation for GLB [x, y, z] in radians
  attachTo?: 'ceiling' | 'wall' // Where to attach the item
}

const CATALOG_ITEMS: CatalogItem[] = [
  {
    category: 'item',
    thumbnail: '/items/couch-medium/thumbnail.webp',
    modelUrl: '/items/couch-medium/model.glb',
    scale: [0.4, 0.4, 0.4],
    size: [4, 2],
  },
  {
    category: 'item',
    thumbnail: '/items/couch-small/thumbnail.webp',
    modelUrl: '/items/couch-small/model.glb',
    scale: [0.4, 0.4, 0.4],
    size: [3, 2],
  },
  {
    category: 'item',
    thumbnail: '/items/desk/thumbnail.webp',
    modelUrl: '/items/desk/model.glb',
    scale: [1, 1, 1],
    size: [4, 2],
  },
  {
    category: 'item',
    thumbnail: '/items/table/thumbnail.webp',
    modelUrl: '/items/table/model.glb',
    scale: [1, 1, 1],
    rotation: [0, Math.PI / 2, 0],
    size: [6, 3],
  },
  {
    category: 'item',
    thumbnail: '/items/ceiling-light/thumbnail.webp',
    modelUrl: '/items/ceiling-light/model.glb',
    scale: [1, 1, 1],
    rotation: [0, 0, 0],
    size: [1, 1],
    attachTo: 'ceiling',
  },
  {
    category: 'item',
    thumbnail: '/items/ceiling-fan/thumbnail.webp',
    modelUrl: '/items/ceiling-fan/model.glb',
    scale: [0.003, 0.003, 0.003],
    position: [0, -0.62, 0],
    rotation: [0, 0, 0],
    size: [1, 1],
    attachTo: 'ceiling',
  },
  {
    category: 'item',
    thumbnail: '/items/wall-art-06/thumbnail.webp',
    modelUrl: '/items/wall-art-06/model.glb',
    position: [0, 1, -0.15],
    scale: [1, 1, 1],
    rotation: [0, 0, 0],
    size: [2, 1],
    attachTo: 'wall',
  },
  {
    category: 'item',
    thumbnail: '/items/flat-screen-tv/thumbnail.webp',
    modelUrl: '/items/flat-screen-tv/model.glb',
    position: [-0.2, 1, -0.15],
    scale: [0.42, 0.42, 0.42],
    rotation: [0, Math.PI, 0],
    size: [4, 1],
    attachTo: 'wall',
  },
  {
    category: 'window',
    thumbnail: '/items/window-small/thumbnail.webp',
    modelUrl: '/items/window-small/model.glb',
    position: [0, 0.5, 0],
    scale: [1, 1, 1],
    rotation: [0, 0, 0],
    size: [2, 1],
    attachTo: 'wall',
  },
  {
    category: 'window',
    thumbnail: '/items/window-round/thumbnail.webp',
    modelUrl: '/items/window-round/model.glb',
    position: [0, 0.5, 0],
    scale: [1, 1, 1],
    rotation: [0, 0, 0],
    size: [2, 1],
    attachTo: 'wall',
  },
  {
    category: 'window',
    thumbnail: '/items/window1-black-open-1731/thumbnail.webp',
    modelUrl: '/items/window1-black-open-1731/model.glb',
    position: [0, 0.5, 0],
    scale: [0.4, 0.4, 0.4],
    rotation: [0, Math.PI, 0],
    size: [2, 1],
    attachTo: 'wall',
  },
  {
    category: 'door',
    thumbnail: '/items/doorway-front/thumbnail.webp',
    modelUrl: '/items/doorway-front/model.glb',
    position: [0, 0, 0],
    scale: [2, 2, 2],
    rotation: [0, 0, 0],
    size: [2, 1],
    attachTo: 'wall',
  },
  {
    category: 'door',
    thumbnail: '/items/door/thumbnail.webp',
    modelUrl: '/items/door/model.glb',
    position: [0, 0, 0],
    scale: [0.2, 0.2, 0.2],
    rotation: [0, 0, 0],
    size: [2, 1],
    attachTo: 'wall',
  },
]

export function ItemCatalog({ category }: { category: CatalogCategory }) {
  const selectedItem = useEditor((state) => state.selectedItem)
  const setSelectedItem = useEditor((state) => state.setSelectedItem)

  const filteredItems = CATALOG_ITEMS.filter((item) => item.category === category)

  // Auto-select first item if current selection is not in the filtered list
  useEffect(() => {
    const isCurrentItemInCategory = filteredItems.some(
      (item) => item.modelUrl === selectedItem.modelUrl,
    )
    if (!isCurrentItemInCategory && filteredItems.length > 0) {
      setSelectedItem(filteredItems[0])
    }
  }, [filteredItems, selectedItem.modelUrl, setSelectedItem])

  return (
    <div className="-mx-2 -my-2 flex gap-2 overflow-x-auto p-2">
      {filteredItems.map((item, index) => {
        const isSelected = selectedItem.modelUrl === item.modelUrl
        return (
          <button
            className={cn(
              'relative aspect-square h-14 w-14 shrink-0 flex-col gap-px rounded-lg transition-all duration-200 ease-out hover:scale-105 hover:cursor-pointer',
              isSelected && 'ring-2 ring-primary-foreground',
            )}
            key={index}
            onClick={() => setSelectedItem(item)}
            type="button"
          >
            <Image
              alt={`Item ${index + 1}`}
              className="rounded-lg object-cover"
              fill
              src={item.thumbnail}
            />
          </button>
        )
      })}
    </div>
  )
}

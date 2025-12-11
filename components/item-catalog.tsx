'use client'

import Image from 'next/image'
import { useEffect } from 'react'
import { type CatalogCategory, useEditor } from '@/hooks/use-editor'
import { cn } from '@/lib/utils'

interface CatalogItem {
  category: CatalogCategory
  name: string
  thumbnail: string
  modelUrl: string
  scale: [number, number, number]
  size: [number, number]
  position?: [number, number, number] // Fine-tune position offset for GLB [x, y, z]
  rotation?: [number, number, number] // Fine-tune rotation for GLB [x, y, z] in radians
  attachTo?: 'ceiling' | 'wall' | 'wall-side' // Where to attach: ceiling, wall (both sides like doors/windows), or wall-side (one side only like art/TV)
}

const CATALOG_ITEMS: CatalogItem[] = [
  {
    category: 'item',
    name: 'Couch',
    thumbnail: '/items/couch-medium/thumbnail.webp',
    modelUrl: '/items/couch-medium/model.glb',
    scale: [0.4, 0.4, 0.4],
    size: [4, 2],
  },
  {
    category: 'item',
    name: 'Small Couch',
    thumbnail: '/items/couch-small/thumbnail.webp',
    modelUrl: '/items/couch-small/model.glb',
    scale: [0.4, 0.4, 0.4],
    size: [3, 2],
  },
  {
    category: 'item',
    name: 'Desk',
    thumbnail: '/items/desk/thumbnail.webp',
    modelUrl: '/items/desk/model.glb',
    scale: [1, 1, 1],
    size: [4, 2],
  },
  {
    category: 'item',
    name: 'Table',
    thumbnail: '/items/table/thumbnail.webp',
    modelUrl: '/items/table/model.glb',
    scale: [1, 1, 1],
    rotation: [0, Math.PI / 2, 0],
    size: [6, 3],
  },
  {
    category: 'item',
    name: 'Fence',
    thumbnail: '/items/fence/thumbnail.webp',
    modelUrl: '/items/fence/model.glb',
    scale: [0.8, 0.8, 0.8],
    position: [0, 0, -0.12],
    rotation: [0, Math.PI, 0],
    size: [6, 1],
  },
  {
    category: 'item',
    name: 'Parking Spot',
    thumbnail: '/items/parking-spot/thumbnail.webp',
    modelUrl: '/items/parking-spot/model.glb',
    scale: [1, 1, 1],
    position: [0, 0, 0],
    rotation: [0, Math.PI, 0],
    size: [12, 6],
  },
  {
    category: 'item',
    name: 'Hedge',
    thumbnail: '/items/hedge/thumbnail.webp',
    modelUrl: '/items/hedge/model.glb',
    scale: [1, 1, 1],
    position: [0, 0, 0],
    rotation: [0, Math.PI, 0],
    size: [4, 3],
  },
  {
    category: 'item',
    name: 'Tree',
    thumbnail: '/items/tree/thumbnail.webp',
    modelUrl: '/items/tree/model.glb',
    scale: [1, 1, 1],
    position: [0, 0, 0],
    rotation: [0, Math.PI, 0],
    size: [2, 2],
  },
  {
    category: 'item',
    name: 'Ceiling Light',
    thumbnail: '/items/ceiling-light/thumbnail.webp',
    modelUrl: '/items/ceiling-light/model.glb',
    scale: [1, 1, 1],
    rotation: [0, 0, 0],
    size: [1, 1],
    attachTo: 'ceiling',
  },
  {
    category: 'item',
    name: 'Ceiling Fan',
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
    name: 'Rectangular Ceiling Light',
    thumbnail: '/items/rectangular-ceiling-light/thumbnail.webp',
    modelUrl: '/items/rectangular-ceiling-light/model.glb',
    scale: [0.04, 0.04, 0.04],
    position: [0.2, -0.1, 0.95],
    rotation: [0, Math.PI / 2, 0],
    size: [2, 4],
    attachTo: 'ceiling',
  },
  {
    category: 'item',
    name: 'Circular Ceiling Light',
    thumbnail: '/items/circular-ceiling-light/thumbnail.webp',
    modelUrl: '/items/circular-ceiling-light/model.glb',
    scale: [1, 1, 1],
    position: [0, -0.1, 0],
    rotation: [0, 0, 0],
    size: [1, 1],
    attachTo: 'ceiling',
  },
  {
    category: 'item',
    name: 'Smoke Detector',
    thumbnail: '/items/smoke-detector/thumbnail.webp',
    modelUrl: '/items/smoke-detector/model.glb',
    scale: [1, 1, 1],
    position: [0, 0, 0],
    rotation: [Math.PI, 0, 0],
    size: [1, 1],
    attachTo: 'ceiling',
  },
  {
    category: 'item',
    name: 'Sprinkler',
    thumbnail: '/items/sprinkler/thumbnail.webp',
    modelUrl: '/items/sprinkler/model.glb',
    scale: [3, 3, 3],
    position: [0, 0, 0],
    rotation: [Math.PI, 0, 0],
    size: [1, 1],
    attachTo: 'ceiling',
  },
  {
    category: 'item',
    name: 'Exit Sign',
    thumbnail: '/items/exit-sign/thumbnail.webp',
    modelUrl: '/items/exit-sign/model.glb',
    scale: [0.5, 0.5, 0.5],
    position: [0, -0.3, 0],
    rotation: [0, 0, 0],
    size: [1, 1],
    attachTo: 'ceiling',
  },
  {
    category: 'item',
    name: 'Wall Art',
    thumbnail: '/items/wall-art-06/thumbnail.webp',
    modelUrl: '/items/wall-art-06/model.glb',
    position: [0, 1, -0.15],
    scale: [1, 1, 1],
    rotation: [0, 0, 0],
    size: [2, 1],
    attachTo: 'wall-side',
  },
  {
    category: 'item',
    name: 'Flat Screen TV',
    thumbnail: '/items/flat-screen-tv/thumbnail.webp',
    modelUrl: '/items/flat-screen-tv/model.glb',
    position: [-0.2, 1, -0.15],
    scale: [0.42, 0.42, 0.42],
    rotation: [0, Math.PI, 0],
    size: [4, 1],
    attachTo: 'wall-side',
  },
  {
    category: 'item',
    name: 'Air Conditioner',
    thumbnail: '/items/air-conditioner/thumbnail.webp',
    modelUrl: '/items/air-conditioner/model.glb',
    position: [0, 2, -0.3],
    scale: [0.0015, 0.0015, 0.0015],
    rotation: [0, Math.PI, 0],
    size: [3, 1],
    attachTo: 'wall-side',
  },
  {
    category: 'item',
    name: 'AC Block',
    thumbnail: '/items/ac-block/thumbnail.webp',
    modelUrl: '/items/ac-block/model.glb',
    position: [0, 0, 0],
    scale: [1, 1, 1],
    rotation: [0, Math.PI, 0],
    size: [3, 3],
  },
  {
    category: 'item',
    name: 'Fire extinguisher',
    thumbnail: '/items/fire-extinguisher/thumbnail.webp',
    modelUrl: '/items/fire-extinguisher/model.glb',
    position: [0, 1.5, -0.22],
    scale: [0.8, 0.8, 0.8],
    rotation: [0, Math.PI / 2, 0],
    size: [1, 1],
    attachTo: 'wall-side',
  },
  {
    category: 'item',
    name: 'Fire alarm ',
    thumbnail: '/items/fire-alarm/thumbnail.webp',
    modelUrl: '/items/fire-alarm/model.glb',
    position: [0, 1, -0.14],
    scale: [0.15, 0.15, 0.15],
    rotation: [0, Math.PI, 0],
    size: [1, 1],
    attachTo: 'wall-side',
  },
  {
    category: 'item',
    name: 'Fire detector ',
    thumbnail: '/items/fire-detector/thumbnail.webp',
    modelUrl: '/items/fire-detector/model.glb',
    position: [0, 1.1, -0.14],
    scale: [2, 2, 2],
    rotation: [0, Math.PI, 0],
    size: [1, 1],
    attachTo: 'wall-side',
  },
  {
    category: 'item',
    name: 'Alarm keypad',
    thumbnail: '/items/alarm-keypad/thumbnail.webp',
    modelUrl: '/items/alarm-keypad/model.glb',
    position: [0, 1.2, -0.1],
    scale: [2, 2, 2],
    rotation: [Math.PI / 2, 0, Math.PI],
    size: [1, 1],
    attachTo: 'wall-side',
  },
  {
    category: 'item',
    name: 'Thermostat',
    thumbnail: '/items/thermostat/thumbnail.webp',
    modelUrl: '/items/thermostat/model.glb',
    position: [0, 1.2, -0.1],
    scale: [5, 5, 5],
    rotation: [0, Math.PI, 0],
    size: [1, 1],
    attachTo: 'wall-side',
  },
  {
    category: 'item',
    name: 'Electric panel',
    thumbnail: '/items/electric-panel/thumbnail.webp',
    modelUrl: '/items/electric-panel/model.glb',
    position: [0, 0.4, -0.16],
    scale: [1, 1, 1],
    rotation: [0, Math.PI, 0],
    size: [2, 1],
    attachTo: 'wall-side',
  },
  {
    category: 'item',
    name: 'Air Conditioner Block',
    thumbnail: '/items/air-conditioner-block/thumbnail.webp',
    modelUrl: '/items/air-conditioner-block/model.glb',
    position: [0, 0.5, 0.06],
    scale: [1, 1, 1],
    rotation: [0, Math.PI, 0],
    size: [2, 1],
  },
  {
    category: 'item',
    name: 'Kitchen Fridge',
    thumbnail: '/items/kitchen-fridge/thumbnail.webp',
    modelUrl: '/items/kitchen-fridge/model.glb',
    position: [0, 0, 0.0],
    scale: [0.7, 0.7, 0.7],
    rotation: [0, Math.PI, 0],
    size: [2, 2],
  },
  {
    category: 'item',
    name: 'Freezer',
    thumbnail: '/items/freezer/thumbnail.webp',
    modelUrl: '/items/freezer/model.glb',
    position: [-0.43, 0, 0.25],
    scale: [1.8, 1.8, 1.8],
    rotation: [0, Math.PI, 0],
    size: [2, 1],
  },
  {
    category: 'item',
    name: 'Wall Sink',
    thumbnail: '/items/wall-sink/thumbnail.webp',
    modelUrl: '/items/wall-sink/model.glb',
    position: [0, 0, -0.25],
    scale: [0.7, 0.7, 0.7],
    rotation: [0, Math.PI, 0],
    size: [2, 1],
    attachTo: 'wall-side',
  },
  {
    category: 'item',
    name: 'Sink with cabinet',
    thumbnail: '/items/sink-cabinet/thumbnail.webp',
    modelUrl: '/items/sink-cabinet/model.glb',
    position: [0, 0.5, 0],
    scale: [1.4, 1.4, 1.4],
    rotation: [0, Math.PI, 0],
    size: [4, 2],
  },
  {
    category: 'item',
    name: 'Toilet',
    thumbnail: '/items/toilet/thumbnail.webp',
    modelUrl: '/items/toilet/model.glb',
    position: [0, 0, -0.1],
    scale: [0.005, 0.005, 0.005],
    rotation: [0, -Math.PI / 4, 0],
    size: [1, 2],
  },
  {
    category: 'window',
    name: 'Window',
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
    name: 'Window',
    thumbnail: '/items/window-small-2/thumbnail.webp',
    modelUrl: '/items/window-small-2/model.glb',
    position: [0, 0.5, 0],
    scale: [1, 1, 1],
    rotation: [0, 0, 0],
    size: [2, 1],
    attachTo: 'wall',
  },
  {
    category: 'window',
    name: 'Window',
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
    name: 'Window',
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
    name: 'Door',
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
    name: 'Door',
    thumbnail: '/items/door/thumbnail.webp',
    modelUrl: '/items/door/model.glb',
    position: [0, 0, 0],
    scale: [0.2, 0.2, 0.2],
    rotation: [0, 0, 0],
    size: [2, 1],
    attachTo: 'wall',
  },
  {
    category: 'door',
    name: 'Door with bar',
    thumbnail: '/items/door-with-bar/thumbnail.webp',
    modelUrl: '/items/door-with-bar/model.glb',
    position: [0, 0, 0],
    scale: [0.65, 0.65, 0.65],
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
    <div className="-mx-2 -my-2 flex max-w-xl gap-2 overflow-x-auto p-2">
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

'use client'

import type { AssetInput } from '@pascal-app/core'
import { resolveCdnUrl } from '@pascal-app/viewer'
import Image from 'next/image'
import { useEffect } from 'react'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from './../../../components/ui/primitives/tooltip'
import { cn } from './../../../lib/utils'
import useEditor, { type CatalogCategory } from './../../../store/use-editor'
import { CATALOG_ITEMS } from './catalog-items'

export function ItemCatalog({ category }: { category: CatalogCategory }) {
  const selectedItem = useEditor((state) => state.selectedItem)
  const setSelectedItem = useEditor((state) => state.setSelectedItem)

  const categoryItems = CATALOG_ITEMS.filter((item) => item.category === category)

  // Auto-select first item if current selection is not in this category
  useEffect(() => {
    const isCurrentItemInCategory = categoryItems.some((item) => item.src === selectedItem?.src)
    if (!isCurrentItemInCategory && categoryItems.length > 0) {
      setSelectedItem(categoryItems[0] as AssetInput)
    }
  }, [categoryItems, selectedItem?.src, setSelectedItem])

  // Get attachment icon based on attachTo type
  const getAttachmentIcon = (attachTo: AssetInput['attachTo']) => {
    if (attachTo === 'wall' || attachTo === 'wall-side') {
      return '/icons/wall.png'
    }
    if (attachTo === 'ceiling') {
      return '/icons/ceiling.png'
    }
    return null
  }

  return (
    <div className="-mx-2 -my-2 flex max-w-xl gap-2 overflow-x-auto p-2">
      {categoryItems.map((item, index) => {
        const isSelected = selectedItem?.src === item?.src
        const attachmentIcon = getAttachmentIcon(item?.attachTo)
        return (
          <Tooltip key={index}>
            <TooltipTrigger asChild>
              <button
                className={cn(
                  'relative aspect-square h-14 min-h-14 w-14 min-w-14 shrink-0 flex-col gap-px rounded-lg transition-all duration-200 ease-out hover:scale-105 hover:cursor-pointer',
                  isSelected && 'ring-2 ring-primary-foreground',
                )}
                onClick={() => setSelectedItem(item)}
                type="button"
              >
                <Image
                  alt={item.name}
                  className="rounded-lg object-cover"
                  fill
                  loading="eager"
                  sizes="56px"
                  src={resolveCdnUrl(item.thumbnail) || ''}
                />
                {attachmentIcon && (
                  <div className="absolute right-0.5 bottom-0.5 flex h-4 w-4 items-center justify-center rounded bg-black/60">
                    <Image
                      alt={item.attachTo === 'ceiling' ? 'Ceiling attachment' : 'Wall attachment'}
                      className="h-4 w-4"
                      height={16}
                      src={attachmentIcon}
                      width={16}
                    />
                  </div>
                )}
              </button>
            </TooltipTrigger>
            <TooltipContent className="text-xs" side="top">
              {item.name}
            </TooltipContent>
          </Tooltip>
        )
      })}
    </div>
  )
}

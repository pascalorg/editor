'use client'

import { useEffect, useState } from 'react'
import { ItemCatalog } from '@/components/item-catalog'
import { TooltipProvider } from '@/components/ui/tooltip'
import { type CatalogCategory, useEditor } from '@/hooks/use-editor'
import { cn } from '@/lib/utils'
import { BuildingTools } from './building-tools'
import { ControlModes } from './control-modes'
import { ViewToggles } from './view-toggles'

export function ActionMenu({ className }: { className?: string }) {
  const controlMode = useEditor((state) => state.controlMode)
  const catalogCategory = useEditor((state) => state.catalogCategory)
  const showBuildingTools = controlMode === 'building'

  // Delayed state for building tools exit animation
  const [shouldRenderTools, setShouldRenderTools] = useState(showBuildingTools)
  const [isToolsVisible, setIsToolsVisible] = useState(showBuildingTools)

  // Delayed state for item catalog exit animation
  const [shouldRenderCatalog, setShouldRenderCatalog] = useState(catalogCategory !== null)
  const [isCatalogVisible, setIsCatalogVisible] = useState(catalogCategory !== null)
  const [currentCategory, setCurrentCategory] = useState<CatalogCategory | null>(catalogCategory)

  useEffect(() => {
    if (showBuildingTools) {
      setShouldRenderTools(true)
      requestAnimationFrame(() => setIsToolsVisible(true))
    } else {
      setIsToolsVisible(false)
      const timeout = setTimeout(() => setShouldRenderTools(false), 200)
      return () => clearTimeout(timeout)
    }
  }, [showBuildingTools])

  useEffect(() => {
    if (catalogCategory) {
      setCurrentCategory(catalogCategory)
      setShouldRenderCatalog(true)
      requestAnimationFrame(() => setIsCatalogVisible(true))
    } else {
      setIsCatalogVisible(false)
      const timeout = setTimeout(() => {
        setShouldRenderCatalog(false)
        setCurrentCategory(null)
      }, 200)
      return () => clearTimeout(timeout)
    }
  }, [catalogCategory])

  return (
    <TooltipProvider>
      <div
        className={cn(
          '-translate-x-1/2 fixed bottom-6 left-1/2 z-50',
          'rounded-2xl border border-zinc-800 bg-zinc-950/90 shadow-2xl backdrop-blur-md',
          'transition-all duration-200 ease-out', // Smooth container resizing
          className,
        )}
      >
        {/* Item Catalog Row - Animated, above Building Tools */}
        {shouldRenderCatalog && currentCategory && (
          <div
            className={cn(
              'overflow-hidden border-zinc-800 transition-all duration-200 ease-out',
              isCatalogVisible
                ? 'max-h-96 border-b px-2 py-2 opacity-100'
                : 'max-h-0 border-b-0 px-2 py-0 opacity-0',
            )}
          >
            <ItemCatalog category={currentCategory} />
          </div>
        )}

        {/* Building Tools Row - Animated */}
        {shouldRenderTools && (
          <div
            className={cn(
              'overflow-hidden border-zinc-800 transition-all duration-200 ease-out',
              isToolsVisible
                ? 'max-h-20 border-b px-2 py-2 opacity-100'
                : 'max-h-0 border-b-0 px-2 py-0 opacity-0',
            )}
          >
            <div className="w-max">
              <BuildingTools />
            </div>
          </div>
        )}

        {/* Control Mode Row - Always visible, centered */}
        <div className="flex items-center justify-center gap-1 px-2 py-1.5">
          <ControlModes />
          <div className="mx-1 h-5 w-px bg-zinc-700" />
          <ViewToggles />
        </div>
      </div>
    </TooltipProvider>
  )
}

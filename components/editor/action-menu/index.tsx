'use client'

import { useEffect, useState } from 'react'
import { ItemCatalog } from '@/components/item-catalog'
import { TooltipProvider } from '@/components/ui/tooltip'
import { useEditor } from '@/hooks/use-editor'
import { cn } from '@/lib/utils'
import { BuildingTools } from './building-tools'
import { ControlModes } from './control-modes'
import { ViewToggles } from './view-toggles'

export function ActionMenu({ className }: { className?: string }) {
  const controlMode = useEditor((state) => state.controlMode)
  const activeTool = useEditor((state) => state.activeTool)
  const showBuildingTools = controlMode === 'building'
  const showItemCatalog = controlMode === 'building' && activeTool === 'item'

  // Delayed state for building tools exit animation
  const [shouldRenderTools, setShouldRenderTools] = useState(showBuildingTools)
  const [isToolsVisible, setIsToolsVisible] = useState(showBuildingTools)

  // Delayed state for item catalog exit animation
  const [shouldRenderCatalog, setShouldRenderCatalog] = useState(showItemCatalog)
  const [isCatalogVisible, setIsCatalogVisible] = useState(showItemCatalog)

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
    if (showItemCatalog) {
      setShouldRenderCatalog(true)
      requestAnimationFrame(() => setIsCatalogVisible(true))
    } else {
      setIsCatalogVisible(false)
      const timeout = setTimeout(() => setShouldRenderCatalog(false), 200)
      return () => clearTimeout(timeout)
    }
  }, [showItemCatalog])

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
        {shouldRenderCatalog && (
          <div
            className={cn(
              'overflow-hidden border-zinc-800 transition-all duration-200 ease-out',
              isCatalogVisible
                ? 'max-h-96 border-b px-2 py-2 opacity-100'
                : 'max-h-0 border-b-0 px-2 py-0 opacity-0',
            )}
          >
            <ItemCatalog />
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
